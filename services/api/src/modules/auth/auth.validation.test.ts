import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../infrastructure/redis.js", () => ({
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

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

const status = (query: Record<string, string>) =>
  request(app).get("/api/v1/auth/status").set(bearer).query(query);

describe("POST /auth/sign-up validation", () => {
  it.each([
    ["an unknown key", { role: "client", extra: 1 }],
    ["a missing role", {}],
    ["an invalid role", { role: "admin" }],
    ["a wrong type role", { role: 5 }],
    ["an array role", { role: ["client"] }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await request(app)
      .post("/api/v1/auth/sign-up")
      .set(bearer)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 400 for an unknown query key", async () => {
    const response = await request(app)
      .post("/api/v1/auth/sign-up?extra=1")
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).toBe(400);
  });

  it("passes validation for a valid body", async () => {
    const response = await request(app)
      .post("/api/v1/auth/sign-up")
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).not.toBe(400);
  });

  it("answers 400 before the controller's 401 without a token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/sign-up")
      .send({ role: "client", extra: 1 });

    expect(response.status).toBe(400);
  });
});

describe("GET /auth/status validation", () => {
  it("answers 400 for an unknown query key", async () => {
    const response = await status({ role: "client", extra: "1" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 400 for an invalid role", async () => {
    const response = await status({ role: "admin" });

    expect(response.status).toBe(400);
  });

  it("answers 401 before 400 without a token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/status")
      .query({ role: "client", extra: "1" });

    expect(response.status).toBe(401);
  });

  it("passes validation for a valid query", async () => {
    const response = await status({ role: "client" });

    expect(response.status).toBe(200);
  });
});
