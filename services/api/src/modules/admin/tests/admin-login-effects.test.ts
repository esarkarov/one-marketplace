import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env } };
});

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: { scan: vi.fn(), type: vi.fn(), ttl: vi.fn(), get: vi.fn() },
}));

vi.mock("@/infrastructure/events/rabbitmq.client.js", () => ({
  getRabbitStatus: () => ({ ok: false }),
}));

vi.mock("@/database/client.js", () => ({
  db: {},
  pool: { end: async () => undefined },
}));

vi.mock("@/middleware/rate-limit/rate-limit.middleware.js", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLoginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { env } = await import("@/config/env.js");
const { adminRouter } = await import("@/modules/admin/admin.route.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");
const { verifyToken } =
  await import("@/middleware/utils/admin-session.utils.js");

const PASSWORD = "login-effects-test-password";
const SECRET = "y".repeat(32);

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: mocks.warn,
    info: mocks.info,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.use(express.json());
app.use("/admin", adminRouter);
app.use(errorHandler);

const login = (password: string) =>
  request(app).post("/admin/auth/login").send({ password });

beforeEach(() => {
  mocks.warn.mockReset();
  mocks.warn.mockResolvedValue(undefined);
  mocks.info.mockReset();
  mocks.info.mockResolvedValue(undefined);
  Object.assign(env, {
    adminDashboardPassword: PASSWORD,
    adminSessionSecret: SECRET,
  });
});

describe("admin login effects", () => {
  it("answers 503 and logs nothing when the password is not configured", async () => {
    Object.assign(env, { adminDashboardPassword: undefined });

    const response = await login(PASSWORD);

    expect(response.status).toBe(503);
    expect(response.body.message).toBe("Internal server error.");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("answers 503 and logs nothing when the session secret is not configured", async () => {
    Object.assign(env, { adminSessionSecret: undefined });

    const response = await login(PASSWORD);

    expect(response.status).toBe(503);
    expect(response.body.message).toBe("Internal server error.");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("logs a failed sign-in with the client address and answers 401", async () => {
    const response = await login("wrong");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Incorrect password.");
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith({
      message: "Admin sign-in failed",
      eventName: "auth.login.failed",
      attributes: {
        "auth.method": "password",
        "auth.failure_kind": "invalid_credentials",
        "client.address": expect.any(String),
      },
    });
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("logs a successful sign-in and returns a verifiable token with an ISO expiry", async () => {
    const response = await login(PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Password verified.");
    expect(Object.keys(response.body.data).sort()).toEqual([
      "expiresAt",
      "token",
    ]);
    const { token, expiresAt } = response.body.data as {
      token: string;
      expiresAt: string;
    };
    expect(new Date(expiresAt).toISOString()).toBe(expiresAt);
    expect(verifyToken(token, SECRET)).toBe(true);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledWith({
      message: "Admin signed in",
      eventName: "auth.login.succeeded",
      attributes: {
        "auth.method": "password",
        "client.address": expect.any(String),
      },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
