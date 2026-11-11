import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

vi.mock("../../database/client.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => mocks.accountRows,
  };
  return {
    db: { select: () => chain },
    pool: { end: async () => undefined },
  };
});

const { app } = await import("../../app.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const bearer = { Authorization: "Bearer test-token" };
const base = "/api/v1/notifications";

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("notifications request validation", () => {
  it.each([
    ["get", base],
    ["patch", `${base}/read-all`],
    ["patch", `${base}/nope/read`],
    ["get", `${base}/stream`],
  ] as const)("%s %s returns 401 before 400", async (method, path) => {
    const response = await request(app)[method](path).query({ extra: "1" });

    expect(response.status).toBe(401);
  });

  it.each([
    ["invalid scope on list", "get", base, { scope: "team" }],
    ["unknown query on list", "get", base, { extra: "1" }],
    ["invalid scope on read-all", "patch", `${base}/read-all`, { scope: "x" }],
    ["unknown query on read-all", "patch", `${base}/read-all`, { extra: "1" }],
    ["bad notification id", "patch", `${base}/nope/read`, {}],
    ["unknown query on read", "patch", `${base}/${id}/read`, { extra: "1" }],
    ["scope on read", "patch", `${base}/${id}/read`, { scope: "agency" }],
    ["invalid scope on stream", "get", `${base}/stream`, { scope: "x" }],
    ["unknown query on stream", "get", `${base}/stream`, { extra: "1" }],
  ] as const)(
    "returns 400 VALIDATION_ERROR for %s",
    async (_name, method, path, query) => {
      const response = await request(app)
        [method](path)
        .set(bearer)
        .query({ role: "client", ...query });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(response.body.success).toBe(false);
    },
  );

  it.each([
    ["list", "get", base, {}],
    ["agency list", "get", base, { scope: "agency" }],
    ["read-all", "patch", `${base}/read-all`, {}],
    ["read one", "patch", `${base}/${id}/read`, {}],
  ] as const)(
    "passes validation for a valid %s",
    async (_name, method, path, query) => {
      const response = await request(app)
        [method](path)
        .set(bearer)
        .query({ role: "freelancer", ...query });

      expect(response.status).not.toBe(400);
    },
  );
});
