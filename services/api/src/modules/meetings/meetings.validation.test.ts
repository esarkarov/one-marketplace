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
const path = (conversationId: string) =>
  `/api/v1/conversations/${conversationId}/meetings`;

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("POST /conversations/:conversationId/meetings", () => {
  it("returns 401 before 400 without a token", async () => {
    const response = await request(app).post(path("nope")).send({});

    expect(response.status).toBe(401);
  });

  it.each([
    ["a bad conversation id", path("nope"), { role: "client" }],
    ["an unknown query key", `${path(id)}?extra=1`, { role: "client" }],
  ])("returns 400 VALIDATION_ERROR for %s", async (_name, url, body) => {
    const response = await request(app).post(url).set(bearer).send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("passes validation for a valid conversation id", async () => {
    const response = await request(app)
      .post(path(id))
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).not.toBe(400);
  });
});
