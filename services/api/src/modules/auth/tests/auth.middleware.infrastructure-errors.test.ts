import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  findAccountOnboardingState: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("@/infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: vi.fn() } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get: async () => null,
    setEx: async () => "OK",
    expire: async () => true,
    del: async () => 1,
    evalSha: async () => [1, 60000],
    scriptLoad: async () => "sha",
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

vi.mock(
  "@/modules/auth/repositories/auth.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/auth/repositories/auth.repository.js")
    >()),
    findAccountOnboardingState: mocks.findAccountOnboardingState,
  }),
);

const { authenticateAccount, isAuthenticated } =
  await import("@/modules/auth/middleware/auth.middleware.js");
const { authRouter } = await import("@/modules/auth/auth.route.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");
const { createHttpLogger } =
  await import("@/middleware/http-logger/http-logger.middleware.js");
const { requestIdMiddleware } =
  await import("@/middleware/request-id/request-id.middleware.js");

const app = express();
app.use(requestIdMiddleware);
app.use(createHttpLogger());
app.use(express.json());
app.use("/auth", authRouter);
app.get("/protected", isAuthenticated, (_request, response) => {
  response.json({ ok: true });
});
app.use(errorHandler);

const bearer = { Authorization: "Bearer test-token" };
const databaseFailure = new Error(
  'connect ECONNREFUSED 127.0.0.1:5432 relation "accounts"',
);

beforeEach(() => {
  mocks.verifyToken.mockReset();
  mocks.findAccountOnboardingState.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_infra", sid: "sess_1" });
  mocks.findAccountOnboardingState.mockRejectedValue(databaseFailure);
});

describe("authentication when the database fails", () => {
  it("authenticateAccount rethrows the database error instead of a 401", async () => {
    await expect(authenticateAccount("token", "client")).rejects.toBe(
      databaseFailure,
    );
  });

  it("GET /auth/status answers the generic 500, not 401", async () => {
    const response = await request(app)
      .get("/auth/status")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      message: "Internal server error.",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED");
  });

  it("POST /auth/sign-up answers the generic 500, not 401", async () => {
    const response = await request(app)
      .post("/auth/sign-up")
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
  });

  it("an isAuthenticated route answers 500, not 401", async () => {
    const response = await request(app)
      .get("/protected")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(500);
  });
});

describe("authentication with a bad token", () => {
  beforeEach(() => {
    mocks.verifyToken.mockRejectedValue(new Error("jwt expired"));
  });

  it("authenticateAccount still answers 401", async () => {
    await expect(authenticateAccount("token", "client")).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.findAccountOnboardingState).not.toHaveBeenCalled();
  });

  it("GET /auth/status and POST /auth/sign-up still answer 401", async () => {
    const status = await request(app)
      .get("/auth/status")
      .query({ role: "client" })
      .set(bearer);
    const signUp = await request(app)
      .post("/auth/sign-up")
      .set(bearer)
      .send({ role: "client" });

    expect(status.status).toBe(401);
    expect(signUp.status).toBe(401);
  });
});
