import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LogEntry {
  eventName: string;
  attributes?: Record<string, unknown>;
}

const hoisted = vi.hoisted(() => ({
  redis: {
    isReady: undefined as boolean | undefined,
    get: vi.fn<(key: string) => Promise<string | null>>(),
    setEx:
      vi.fn<(key: string, ttl: number, value: string) => Promise<string>>(),
    expire: vi.fn<(key: string, ttl: number) => Promise<number>>(),
  },
  warn: vi.fn<(entry: LogEntry) => Promise<void>>(),
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: hoisted.redis,
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    warn: hoisted.warn,
    info: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  },
}));

const KEY = "account-auth:user_secret_key:client";

const load = async () => {
  vi.resetModules();
  const cache = await import("./fail-open.cache.js");
  const status = await import("./redis-status.cache.js");
  return { ...cache, ...status };
};

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

const degradedLogs = () =>
  hoisted.warn.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry.eventName === "cache.redis.degraded");

beforeEach(() => {
  hoisted.redis.isReady = undefined;
  hoisted.redis.get.mockReset().mockResolvedValue("cached");
  hoisted.redis.setEx.mockReset().mockResolvedValue("OK");
  hoisted.redis.expire.mockReset().mockResolvedValue(1);
  hoisted.warn.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fail-open cache", () => {
  it("returns the value and logs nothing when Redis answers", async () => {
    const { cacheGet, consumeRedisDegraded } = await load();

    expect(await cacheGet(KEY)).toBe("cached");
    await flush();
    expect(degradedLogs()).toHaveLength(0);
    expect(consumeRedisDegraded()).toBe(false);
  });

  it("returns null and logs a degraded warning without the key when get rejects", async () => {
    const { cacheGet, consumeRedisDegraded } = await load();
    hoisted.redis.get.mockRejectedValue(
      Object.assign(new Error(`failed for ${KEY}`), {
        name: "ConnectionError",
      }),
    );

    expect(await cacheGet(KEY)).toBeNull();
    await flush();

    expect(degradedLogs()).toEqual([
      expect.objectContaining({
        eventName: "cache.redis.degraded",
        attributes: { "cache.op": "get", "error.name": "ConnectionError" },
      }),
    ]);
    expect(JSON.stringify(hoisted.warn.mock.calls)).not.toContain(KEY);
    expect(consumeRedisDegraded()).toBe(true);
  });

  it("returns null once the 300 ms command timeout passes", async () => {
    vi.useFakeTimers();
    const { cacheGet } = await load();
    hoisted.redis.get.mockReturnValue(new Promise<never>(() => undefined));

    const pending = cacheGet(KEY);
    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    await flush();
    expect(degradedLogs()[0]?.attributes?.["error.name"]).toBe(
      "CacheTimeoutError",
    );
  });

  it("does not call Redis when the client reports it is not ready", async () => {
    const { cacheGet, cacheSetEx, cacheExpire } = await load();
    hoisted.redis.isReady = false;

    expect(await cacheGet(KEY)).toBeNull();
    await cacheSetEx(KEY, 60, "value");
    await cacheExpire(KEY, 60);
    await flush();

    expect(hoisted.redis.get).not.toHaveBeenCalled();
    expect(hoisted.redis.setEx).not.toHaveBeenCalled();
    expect(hoisted.redis.expire).not.toHaveBeenCalled();
    expect(degradedLogs()[0]?.attributes?.["error.name"]).toBe(
      "RedisNotReadyError",
    );
  });

  it("runs the command when isReady is true or absent", async () => {
    const { cacheGet } = await load();
    hoisted.redis.isReady = true;
    expect(await cacheGet(KEY)).toBe("cached");
    hoisted.redis.isReady = undefined;
    expect(await cacheGet(KEY)).toBe("cached");
    expect(hoisted.redis.get).toHaveBeenCalledTimes(2);
  });

  it("resolves without throwing when setEx or expire rejects", async () => {
    const { cacheSetEx, cacheExpire } = await load();
    hoisted.redis.setEx.mockRejectedValue(new Error("setEx failed"));
    hoisted.redis.expire.mockRejectedValue(new Error("expire failed"));

    await expect(cacheSetEx(KEY, 60, "value")).resolves.toBeUndefined();
    await expect(cacheExpire(KEY, 60)).resolves.toBeUndefined();
    expect(hoisted.redis.setEx).toHaveBeenCalledWith(KEY, 60, "value");
  });

  it("treats a non-string reply as a miss", async () => {
    const { cacheGet } = await load();
    hoisted.redis.get.mockResolvedValue(null);
    expect(await cacheGet(KEY)).toBeNull();
  });

  it("logs at most one degraded warning per minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { cacheGet, cacheSetEx } = await load();
    hoisted.redis.get.mockRejectedValue(new Error("down"));
    hoisted.redis.setEx.mockRejectedValue(new Error("down"));

    await cacheGet(KEY);
    await cacheSetEx(KEY, 60, "value");
    vi.setSystemTime(new Date("2026-01-01T00:00:59Z"));
    await cacheGet(KEY);
    await flush();
    expect(degradedLogs()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    await cacheSetEx(KEY, 60, "value");
    await flush();
    expect(degradedLogs()).toHaveLength(2);
    expect(degradedLogs()[1]?.attributes?.["cache.op"]).toBe("setEx");
  });

  it("does not throw when the logger itself fails", async () => {
    const { cacheGet } = await load();
    hoisted.warn.mockImplementation(() => {
      throw new Error("logger broke");
    });
    hoisted.redis.get.mockRejectedValue(new Error("down"));

    await expect(cacheGet(KEY)).resolves.toBeNull();
    await flush();
  });
});
