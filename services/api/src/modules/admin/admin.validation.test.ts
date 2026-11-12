import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    scan: vi.fn(),
    type: vi.fn(),
    ttl: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock("../../infrastructure/rabbitmq.js", () => ({
  getRabbitStatus: async () => ({ ok: false }),
}));

vi.mock("../../database/client.js", () => ({
  db: {},
  pool: { end: async () => undefined },
}));

vi.mock("../../shared/http/rate-limit.middleware.js", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLoginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { adminRouter } = await import("./admin.route.js");
const { errorHandler } = await import("../../shared/http/error.middleware.js");

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

const sessionToken = () => {
  const expiresAt = String(Date.now() + 60_000);
  const signature = createHmac(
    "sha256",
    process.env.ADMIN_SESSION_SECRET as string,
  )
    .update(expiresAt)
    .digest("hex");
  return `${expiresAt}.${signature}`;
};

const bearer = () => ({ Authorization: `Bearer ${sessionToken()}` });

describe("POST /admin/auth/login validation", () => {
  it.each([
    ["an unknown key", { password: "x", extra: 1 }],
    ["a wrong type", { password: 5 }],
    ["a missing password", {}],
    ["an oversized password", { password: "a".repeat(1025) }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await request(app).post("/admin/auth/login").send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 400 for an unknown query key", async () => {
    const response = await request(app)
      .post("/admin/auth/login?extra=1")
      .send({ password: "x" });

    expect(response.status).toBe(400);
  });

  it("passes validation for a valid body", async () => {
    const response = await request(app)
      .post("/admin/auth/login")
      .send({ password: "wrong" });

    expect(response.status).toBe(401);
  });
});

describe("admin list and overview validation", () => {
  it.each([
    "/admin/overview/activity",
    "/admin/accounts",
    "/admin/job-posts",
    "/admin/proposals",
    "/admin/contracts",
    "/admin/transactions",
  ])("GET %s validates limit and offset", async (path) => {
    const unknown = await request(app)
      .get(path)
      .set(bearer())
      .query({ extra: "1" });
    const badLimit = await request(app)
      .get(path)
      .set(bearer())
      .query({ limit: "abc" });
    const badOffset = await request(app)
      .get(path)
      .set(bearer())
      .query({ offset: "-1" });
    const oversized = await request(app)
      .get(path)
      .set(bearer())
      .query({ limit: "1".repeat(11) });
    const valid = await request(app)
      .get(path)
      .set(bearer())
      .query({ limit: "10", offset: "0" });

    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("VALIDATION_ERROR");
    expect(badLimit.status).toBe(400);
    expect(badOffset.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(valid.status).not.toBe(400);
  });

  it.each(["/admin/overview", "/admin/system/health"])(
    "GET %s answers 400 for an unknown query key",
    async (path) => {
      const response = await request(app)
        .get(path)
        .set(bearer())
        .query({ extra: "1" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    },
  );

  it.each([
    "/admin/overview",
    "/admin/accounts",
    "/admin/system/health",
    "/admin/system/redis/keys/connects:1",
  ])("GET %s answers 401 before 400", async (path) => {
    const response = await request(app).get(path).query({ extra: "1" });

    expect(response.status).toBe(401);
  });
});

describe("admin redis validation", () => {
  it.each([
    ["an unknown key", { pattern: "connects:*", extra: "1" }],
    ["a missing pattern", {}],
    ["an oversized pattern", { pattern: `connects:${"a".repeat(64)}` }],
    ["a disallowed prefix", { pattern: "other:*" }],
  ])("GET /system/redis/keys answers 400 for %s", async (_name, query) => {
    const response = await request(app)
      .get("/admin/system/redis/keys")
      .set(bearer())
      .query(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /system/redis/keys passes validation for a valid pattern", async () => {
    const response = await request(app)
      .get("/admin/system/redis/keys")
      .set(bearer())
      .query({ pattern: "connects:*" });

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["an oversized key", `/admin/system/redis/keys/${"a".repeat(129)}`],
    ["bad characters", "/admin/system/redis/keys/a%20b"],
    ["an unknown query key", "/admin/system/redis/keys/connects:1?extra=1"],
  ])("GET /system/redis/keys/:key answers 400 for %s", async (_name, path) => {
    const response = await request(app).get(path).set(bearer());

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /system/redis/keys/:key passes validation for a valid key", async () => {
    const response = await request(app)
      .get("/admin/system/redis/keys/connects:1")
      .set(bearer());

    expect(response.status).not.toBe(400);
  });
});

describe("GET /admin/logs/stream validation", () => {
  it("answers 401 before 400 without a token", async () => {
    const response = await request(app)
      .get("/admin/logs/stream")
      .query({ extra: "1" });

    expect(response.status).toBe(401);
  });

  it.each([
    ["an unknown key", { token: "x", extra: "1" }],
    ["an oversized token", { token: "a".repeat(2049) }],
  ])("answers 400 for %s", async (_name, query) => {
    const response = await request(app)
      .get("/admin/logs/stream")
      .set(bearer())
      .query(query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("passes validation with a valid query token", async () => {
    const response = await request(app)
      .get("/admin/logs/stream")
      .query({ token: sessionToken() });

    expect(response.status).toBe(503);
  });
});
