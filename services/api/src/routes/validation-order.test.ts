import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../infrastructure/redis.js", () => ({
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

vi.mock("../database/client.js", () => {
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

const { app } = await import("../app.js");

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

const invalid = "/api/v1/jobs/not-a-uuid?extra=1&role=client";

describe("middleware runs before validation", () => {
  it.each([
    ["isAuthenticated", "get", "/api/v1/jobs/not-a-uuid?extra=1&role=client"],
    [
      "isAuthenticated on a mutation",
      "patch",
      "/api/v1/contracts/not-a-uuid/accept?extra=1&role=client",
    ],
    [
      "verifyBearerToken",
      "put",
      "/api/v1/freelancer/profile?extra=1&role=freelancer",
    ],
    ["the admin session guard", "get", "/api/v1/admin/overview?extra=1"],
  ] as const)("%s answers 401 before 400", async (_kind, method, path) => {
    const response = await request(app)[method](path).send({ extra: 1 });

    expect(response.status).toBe(401);
  });

  it.each([
    ["get", invalid],
    ["patch", "/api/v1/contracts/not-a-uuid/accept?extra=1&role=client"],
  ] as const)(
    "%s answers 403 before 400 when the role has no account",
    async (method, path) => {
      mocks.accountRows = [];

      const response = await request(app)
        [method](path)
        .set({ Authorization: "Bearer test-token" })
        .send({ extra: 1 });

      expect(response.status).toBe(403);
    },
  );

  it("answers 403 before 400 for resolveAccountRole when the role has no account", async () => {
    mocks.accountRows = [];

    const response = await request(app)
      .put("/api/v1/freelancer/profile?extra=1&role=freelancer")
      .set({ Authorization: "Bearer test-token" })
      .send({ extra: 1 });

    expect(response.status).toBe(403);
  });

  it("reaches validation once authenticated", async () => {
    const response = await request(app)
      .get(invalid)
      .set({ Authorization: "Bearer test-token" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
