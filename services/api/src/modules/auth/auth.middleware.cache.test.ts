import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const entries = new Map<
    string,
    { value: string; ttl: number; expiresAt?: number }
  >();
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

vi.mock("../../config/env.js", () => ({
  env: { clerkSecretKey: "sk_test" },
}));

vi.mock("../../config/logger.js", () => ({
  logger: { warn: mocks.warn },
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    get: async (key: string) => {
      const entry = mocks.entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
        mocks.entries.delete(key);
        return null;
      }
      return entry.value;
    },
    expire: async (key: string, ttl: number) => {
      mocks.expire(key, ttl);
      const entry = mocks.entries.get(key);
      if (entry) entry.ttl = ttl;
      return true;
    },
    setEx: async (key: string, ttl: number, value: string) => {
      mocks.setEx(key, ttl, value);
      mocks.entries.set(key, {
        value,
        ttl,
        expiresAt: Date.now() + ttl * 1000,
      });
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

vi.mock("../../database/client.js", () => {
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

const { authenticateAccount } = await import("./auth.middleware.js");
const { invalidateAccountAuthCache } =
  await import("../../infrastructure/account-auth-cache.js");

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

describe("negative account cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches a missing account for 30 seconds", async () => {
    await authenticateAccount("token", "client");

    expect(mocks.setEx).toHaveBeenCalledWith(
      "account:auth:user_1:client",
      30,
      expect.stringContaining('"accountExists":false'),
    );
  });

  it("caches an existing account with the positive TTL", async () => {
    mocks.accountRows = [{ isOnboardingComplete: true }];

    await authenticateAccount("token", "client");

    expect(mocks.setEx).toHaveBeenCalledWith(
      "account:auth:user_1:client",
      600,
      expect.stringContaining('"accountExists":true'),
    );
  });

  it("sees a new account once a stale negative entry expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    const stale = await authenticateAccount("token", "client");
    expect(stale.accountExists).toBe(false);

    mocks.accountRows = [{ isOnboardingComplete: false }];
    vi.advanceTimersByTime(29_000);
    expect((await authenticateAccount("token", "client")).accountExists).toBe(
      false,
    );
    expect(mocks.dbReads).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    const fresh = await authenticateAccount("token", "client");
    expect(fresh.accountExists).toBe(true);
    expect(mocks.dbReads).toHaveBeenCalledTimes(2);
  });

  it("is cleared by invalidation after sign-up even when the TTL has not passed", async () => {
    await authenticateAccount("token", "client");
    mocks.accountRows = [{ isOnboardingComplete: false }];

    await invalidateAccountAuthCache("user_1");

    expect((await authenticateAccount("token", "client")).accountExists).toBe(
      true,
    );
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
