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
  redis: { get: async () => null, setEx: async () => "OK" },
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

const { authorizeSocket } =
  await import("@/modules/messaging/messaging.socket.js");

const handshake = async () => {
  const next = vi.fn();
  const socket = {
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: "test-token", role: "client" } },
  };
  await authorizeSocket(socket as never, next);
  return { error: next.mock.calls[0]?.[0] as Error | undefined, socket };
};

beforeEach(() => {
  mocks.verifyToken.mockReset();
  mocks.findAccountOnboardingState.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_socket", sid: "sess_1" });
  mocks.findAccountOnboardingState.mockResolvedValue({
    id: "4b7b3f4e-5a1d-4f0e-9a33-6b1c3d2e1f00",
    isOnboardingComplete: true,
  });
});

describe("socket handshake", () => {
  it("rejects with a generic error, not the token error, when the database fails", async () => {
    mocks.findAccountOnboardingState.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    );

    const { error, socket } = await handshake();

    expect(error?.message).toBe("Internal server error.");
    expect(socket.data.auth).toBeUndefined();
  });

  it("still rejects a bad token with the token error", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("jwt expired"));

    const { error } = await handshake();

    expect(error?.message).toBe("Authentication token is invalid or expired.");
    expect(mocks.findAccountOnboardingState).not.toHaveBeenCalled();
  });

  it("accepts a valid token with an existing account", async () => {
    const { error, socket } = await handshake();

    expect(error).toBeUndefined();
    expect(socket.data.auth).toMatchObject({
      userId: "user_socket",
      accountExists: true,
    });
  });
});
