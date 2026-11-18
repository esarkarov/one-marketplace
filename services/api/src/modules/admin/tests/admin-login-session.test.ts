import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
  return { ...original, env: { ...original.env } };
});

vi.mock("../../../infrastructure/cache/redis.client.js", () => ({
  redis: { scan: vi.fn(), type: vi.fn(), ttl: vi.fn(), get: vi.fn() },
}));

vi.mock("../../../infrastructure/events/rabbitmq.client.js", () => ({
  getRabbitStatus: () => ({ ok: false }),
}));

vi.mock("../../../database/client.js", () => ({
  db: {},
  pool: { end: async () => undefined },
}));

vi.mock("../../../middleware/rate-limit/rate-limit.middleware.js", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLoginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { env } = await import("../../../config/env.js");
const { adminRouter } = await import("../admin.route.js");
const { errorHandler } =
  await import("../../../middleware/error/error.middleware.js");
const { adminResponses } = await import("../responses/admin.responses.js");
const { ADMIN_SESSION_TTL_MS } =
  await import("../../../middleware/constants/admin-session.constants.js");

const PASSWORD = "login-session-test-password";
const SECRET = "x".repeat(32);

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: async () => undefined,
    info: async () => undefined,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.use(express.json());
app.use("/admin", adminRouter);
app.use(errorHandler);

const GUARDED = "/admin/overview?extra=1";

const login = (password: string) =>
  request(app).post("/admin/auth/login").send({ password });

const forge = (secret: string, expiresAt: number) => {
  const raw = String(expiresAt);
  return `${raw}.${createHmac("sha256", secret).update(raw).digest("hex")}`;
};

beforeEach(() => {
  Object.assign(env, {
    adminDashboardPassword: PASSWORD,
    adminSessionSecret: SECRET,
  });
});

describe("admin login session token", () => {
  it("returns no token for a wrong password", async () => {
    const response = await login("wrong-password");

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain("token");
    adminResponses.login[401].parse(response.body);
  });

  it("returns a token the real admin guard accepts", async () => {
    const before = Date.now();
    const response = await login(PASSWORD);

    expect(response.status).toBe(200);
    const body = adminResponses.login[200].parse(response.body);
    const { token, expiresAt } = body.data;

    const encoded = Number(token.split(".")[0]);
    expect(new Date(expiresAt).getTime()).toBe(encoded);
    expect(encoded).toBeGreaterThanOrEqual(before + ADMIN_SESSION_TTL_MS);
    expect(encoded).toBeLessThanOrEqual(Date.now() + ADMIN_SESSION_TTL_MS);

    const guarded = await request(app)
      .get(GUARDED)
      .set("Authorization", `Bearer ${token}`);
    expect(guarded.status).toBe(400);
    expect(guarded.body.code).toBe("VALIDATION_ERROR");

    const anonymous = await request(app).get(GUARDED);
    expect(anonymous.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const response = await request(app)
      .get(GUARDED)
      .set("Authorization", `Bearer ${forge(SECRET, Date.now() - 1_000)}`);

    expect(response.status).toBe(401);
  });

  it("rejects a token signed with another secret", async () => {
    const response = await request(app)
      .get(GUARDED)
      .set(
        "Authorization",
        `Bearer ${forge("y".repeat(32), Date.now() + 60_000)}`,
      );

    expect(response.status).toBe(401);
  });

  it("answers 503 and mints nothing when the session secret is not configured", async () => {
    Object.assign(env, { adminSessionSecret: undefined });

    const response = await login(PASSWORD);

    expect(response.status).toBe(503);
    const guard = await request(app).get(GUARDED);
    expect(guard.status).toBe(503);
    expect(response.body).toEqual({
      ...guard.body,
      requestId: expect.any(String),
    });
    expect(response.body.data).toBeUndefined();
    adminResponses.login[503].parse(response.body);
  });
});
