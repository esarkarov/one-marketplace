import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const entries = new Map<string, { value: string; ttl: number }>();
  return {
    entries,
    accountRows: [] as unknown[],
    dbReads: vi.fn(),
    verifyToken: vi.fn(),
    expire: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
    warn: vi.fn(),
    delError: null as Error | null,
  };
});

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../config/env.js", () => ({ env: { clerkSecretKey: "sk_test" } }));

vi.mock("../config/logger.js", () => ({
  logger: { warn: mocks.warn },
}));

vi.mock("../config/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.entries.get(key)?.value ?? null,
    expire: async (key: string, ttl: number) => {
      mocks.expire(key, ttl);
      const entry = mocks.entries.get(key);
      if (entry) entry.ttl = ttl;
      return true;
    },
    setEx: async (key: string, ttl: number, value: string) => {
      mocks.setEx(key, ttl, value);
      mocks.entries.set(key, { value, ttl });
      return "OK";
    },
    del: async (keys: string | string[]) => {
      mocks.del(keys);
      if (mocks.delError) throw mocks.delError;
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mocks.entries.delete(key);
      }
      return 1;
    },
  },
}));

vi.mock("../database/client.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => {
      mocks.dbReads();
      return mocks.accountRows;
    },
  };
  return { db: { select: () => chain } };
});

const { authenticateAccount, invalidateAccountAuthCache } =
  await import("./auth.middleware.js");

beforeEach(() => {
  mocks.entries.clear();
  mocks.accountRows = [];
  mocks.delError = null;
  for (const mock of [
    mocks.dbReads,
    mocks.expire,
    mocks.setEx,
    mocks.del,
    mocks.warn,
  ]) {
    mock.mockReset();
  }
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("account auth cache lookup", () => {
  it("returns a cached entry without extending its TTL", async () => {
    mocks.entries.set("account:auth:user_1:client", {
      value: JSON.stringify({
        userId: "user_1",
        role: "client",
        accountExists: true,
        isOnboarded: true,
      }),
      ttl: 123,
    });

    const result = await authenticateAccount("token", "client");

    expect(result).toMatchObject({ accountExists: true, isOnboarded: true });
    expect(mocks.dbReads).not.toHaveBeenCalled();
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.entries.get("account:auth:user_1:client")?.ttl).toBe(123);
  });

  it("reads the database once on a miss and writes with the fixed TTL", async () => {
    mocks.accountRows = [{ isOnboardingComplete: true }];

    await authenticateAccount("token", "client");
    const second = await authenticateAccount("token", "client");

    expect(mocks.dbReads).toHaveBeenCalledOnce();
    expect(mocks.setEx).toHaveBeenCalledOnce();
    expect(mocks.setEx).toHaveBeenCalledWith(
      "account:auth:user_1:client",
      600,
      expect.any(String),
    );
    expect(second).toMatchObject({ accountExists: true, isOnboarded: true });
    expect(mocks.expire).not.toHaveBeenCalled();
  });
});

describe("invalidateAccountAuthCache", () => {
  it("deletes both role keys for the user and keeps other users", async () => {
    for (const key of [
      "account:auth:user_1:client",
      "account:auth:user_1:freelancer",
      "account:auth:user_2:client",
      "account:auth:user_2:freelancer",
    ]) {
      mocks.entries.set(key, { value: "{}", ttl: 600 });
    }

    await invalidateAccountAuthCache("user_1");

    expect(mocks.del).toHaveBeenCalledOnce();
    expect(mocks.del).toHaveBeenCalledWith([
      "account:auth:user_1:client",
      "account:auth:user_1:freelancer",
    ]);
    expect([...mocks.entries.keys()]).toEqual([
      "account:auth:user_2:client",
      "account:auth:user_2:freelancer",
    ]);
  });

  it("does not throw on a Redis failure and logs a sanitized warning", async () => {
    const failure = new Error("redis down");
    mocks.delError = failure;

    await expect(invalidateAccountAuthCache("user_1")).resolves.toBeUndefined();

    expect(mocks.warn).toHaveBeenCalledOnce();
    const payload = mocks.warn.mock.calls[0]![0];
    expect(payload.eventName).toBe("auth.cache.invalidate_failed");
    expect(payload.attributes).toEqual({ "error.message": "redis down" });
    expect(JSON.stringify(payload)).not.toContain("stack");
    expect(Object.values(payload.attributes)).not.toContain(failure);
  });

  it("makes the next lookup read the database and see a new account", async () => {
    await authenticateAccount("token", "client");
    expect(mocks.dbReads).toHaveBeenCalledTimes(1);

    const stale = await authenticateAccount("token", "client");
    expect(stale.accountExists).toBe(false);
    expect(mocks.dbReads).toHaveBeenCalledTimes(1);

    mocks.accountRows = [{ isOnboardingComplete: false }];
    await invalidateAccountAuthCache("user_1");

    const fresh = await authenticateAccount("token", "client");
    expect(mocks.dbReads).toHaveBeenCalledTimes(2);
    expect(fresh.accountExists).toBe(true);
  });
});
