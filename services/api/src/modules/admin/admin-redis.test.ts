import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  type: vi.fn(),
  ttl: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    scan: mocks.scan,
    type: mocks.type,
    ttl: mocks.ttl,
    get: mocks.get,
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

vi.mock("../../shared/http/admin-session.middleware.js", () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) =>
    next();
  return {
    requireAdminSession: passThrough,
    requireAdminSessionAllowingQueryToken: passThrough,
  };
});

const { adminRouter } = await import("./admin.route.js");
const { errorHandler } = await import("../../shared/http/error.middleware.js");

const app = express();
app.use("/admin", adminRouter);
app.use(errorHandler);

const scan = (pattern: string) =>
  request(app).get("/admin/system/redis/keys").query({ pattern });

const clerkId = "user_2AbCdEfGhIjKlMnOpQrStUvWxYz";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ttl.mockResolvedValue(60);
  mocks.type.mockResolvedValue("string");
});

describe("admin redis scan", () => {
  it.each([
    "account:auth:*",
    "connects:*",
    "webhook:daily:*",
    "connects:abc_1-2:freelancer",
    `account:auth:${clerkId}:*`,
  ])("accepts %s", async (pattern) => {
    mocks.scan.mockResolvedValue({ cursor: "0", keys: [] });
    const response = await scan(pattern);
    expect(response.status).toBe(200);
    expect(mocks.scan).toHaveBeenCalledWith("0", {
      MATCH: pattern,
      COUNT: 100,
    });
  });

  it.each([
    ["wildcard only", "*"],
    ["partial prefix", "acc*"],
    ["too long", `connects:${"a".repeat(56)}`],
    ["bracket", "connects:[ab]"],
    ["backslash", "connects:\\*"],
    ["space", "connects: x"],
    ["empty", ""],
  ])("rejects %s with 400", async (_name, pattern) => {
    const response = await scan(pattern);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("accepts a 64 character pattern and rejects 65", async () => {
    mocks.scan.mockResolvedValue({ cursor: "0", keys: [] });
    const ok = `connects:${"a".repeat(55)}`;
    expect(ok).toHaveLength(64);
    expect((await scan(ok)).status).toBe(200);
    expect((await scan(`${ok}a`)).status).toBe(400);
  });

  it("rejects a missing pattern", async () => {
    const response = await request(app).get("/admin/system/redis/keys");
    expect(response.status).toBe(400);
  });

  it("filters returned keys through the allowlist", async () => {
    mocks.scan.mockResolvedValue({
      cursor: "0",
      keys: ["connects:u1:freelancer", "session:secret", "other:x"],
    });
    const response = await scan("connects:*");
    expect(response.status).toBe(200);
    expect(response.body.data.keys.map((k: { key: string }) => k.key)).toEqual([
      "connects:u1:freelancer",
    ]);
  });
});

describe("admin redis key value", () => {
  it("returns 403 for a key outside the allowlist", async () => {
    const response = await request(app).get(
      "/admin/system/redis/keys/session:1",
    );
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(mocks.type).not.toHaveBeenCalled();
  });

  it("rejects invalid characters and long keys with 400", async () => {
    const bad = await request(app).get("/admin/system/redis/keys/connects:*");
    expect(bad.status).toBe(400);
    const long = await request(app).get(
      `/admin/system/redis/keys/connects:${"a".repeat(130)}`,
    );
    expect(long.status).toBe(400);
  });

  it("redacts account:auth values", async () => {
    const secret = "super-secret-account-payload";
    mocks.get.mockResolvedValue(secret);
    const response = await request(app).get(
      `/admin/system/redis/keys/account:auth:${clerkId}:client`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      type: "string",
      ttl: 60,
      value: "[REDACTED]",
    });
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(mocks.get).toHaveBeenCalled();
  });

  it("redacts large account:auth values before truncation", async () => {
    mocks.get.mockResolvedValue("x".repeat(10_000));
    const response = await request(app).get(
      "/admin/system/redis/keys/account:auth:u1:client",
    );
    expect(response.body.data.value).toBe("[REDACTED]");
    expect(JSON.stringify(response.body)).not.toContain("xxx");
  });

  it("shows connects values", async () => {
    mocks.get.mockResolvedValue("42");
    const response = await request(app).get(
      "/admin/system/redis/keys/connects:u1:freelancer",
    );
    expect(response.status).toBe(200);
    expect(response.body.data.value).toBe("42");
  });
});
