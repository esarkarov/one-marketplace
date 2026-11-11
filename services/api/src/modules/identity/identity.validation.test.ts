import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/stripe.js", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    identity: { verificationSessions: { create: vi.fn() } },
  },
}));

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

const bearer = { Authorization: "Bearer test-token" };
const path = "/api/v1/identity/session";

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("POST /identity/session validation", () => {
  it("returns 401 before 400 without a token", async () => {
    const response = await request(app).post(path).query({ context: "x" });

    expect(response.status).toBe(401);
  });

  it.each([
    ["an unknown context", { context: "team" }],
    ["an oversized context", { context: "x".repeat(33) }],
    ["an unknown query key", { extra: "1" }],
  ])("returns 400 VALIDATION_ERROR for %s", async (_name, query) => {
    const response = await request(app)
      .post(path)
      .set(bearer)
      .query({ role: "freelancer", ...query });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["no context", {}],
    ["agency context", { context: "agency" }],
  ])("passes validation with %s", async (_name, query) => {
    const response = await request(app)
      .post(path)
      .set(bearer)
      .query({ role: "freelancer", ...query });

    expect(response.status).not.toBe(400);
  });
});
