import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", () => ({
  env: {
    clerkSecretKey: "sk_test",
    clientDashboard: "https://client.example.test/",
    freelancerDashboard: "https://freelancer.example.test",
  },
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: { get: async () => null, setEx: async () => "OK" },
}));

vi.mock("../../database/client.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => mocks.accountRows,
  };
  return { db: { select: () => chain } };
});

const { allowedOrigins } = await import("../../config/cors.js");
const { authenticateAccount, isAuthenticated } =
  await import("./auth.middleware.js");

const run = (handler: typeof isAuthenticated) =>
  new Promise<unknown>((resolve) => {
    void handler(
      {
        headers: { authorization: "Bearer token" },
        body: { role: "client" },
        query: {},
      } as never,
      {} as never,
      (error?: unknown) => resolve(error),
    );
  });

beforeEach(() => {
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("authorizedParties", () => {
  it("passes the normalized cors origins to verifyToken in authenticateAccount", async () => {
    await authenticateAccount("token", "client");

    expect(allowedOrigins).toContain("https://client.example.test");
    expect(mocks.verifyToken).toHaveBeenCalledWith("token", {
      secretKey: "sk_test",
      authorizedParties: allowedOrigins,
    });
  });

  it("passes the cors origins to verifyToken in isAuthenticated", async () => {
    const error = await run(isAuthenticated);

    expect(error).toBeUndefined();
    expect(mocks.verifyToken).toHaveBeenCalledWith("token", {
      secretKey: "sk_test",
      authorizedParties: allowedOrigins,
    });
  });

  it("answers 401 when verifyToken rejects an unauthorized party", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("azp mismatch"));

    await expect(authenticateAccount("token", "client")).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(await run(isAuthenticated)).toMatchObject({ statusCode: 401 });
  });
});
