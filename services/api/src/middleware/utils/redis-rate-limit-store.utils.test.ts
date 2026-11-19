import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Options } from "express-rate-limit";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_INCREMENT_SCRIPT,
  RATE_LIMIT_STORE_TIMEOUT_MS,
  RATE_LIMIT_STORE_WARN_INTERVAL_MS,
} from "@/middleware/constants/rate-limit.constants.js";

interface FakeEntry {
  count: number;
  expiresAt: number;
}

const mocks = vi.hoisted(() => ({
  isReady: true,
  entries: new Map<string, { count: number; expiresAt: number }>(),
  evalImpl: undefined as
    undefined | ((script: string, options: unknown) => unknown),
  loggerWarn: vi.fn(),
  del: vi.fn(),
}));

const entries = mocks.entries as Map<string, FakeEntry>;

const evalFake = vi.fn(
  async (script: string, options: { keys: string[]; arguments?: string[] }) => {
    if (mocks.evalImpl) return mocks.evalImpl(script, options);
    const key = options.keys[0]!;
    const now = Date.now();
    let entry = entries.get(key);
    if (entry && entry.expiresAt <= now) {
      entries.delete(key);
      entry = undefined;
    }
    if (script.includes("INCR")) {
      if (!entry) {
        entry = {
          count: 0,
          expiresAt: script.includes("PEXPIRE")
            ? now + Number(options.arguments![0])
            : Number.POSITIVE_INFINITY,
        };
        entries.set(key, entry);
      }
      entry.count += 1;
      const ttl = Number.isFinite(entry.expiresAt) ? entry.expiresAt - now : -1;
      return [entry.count, ttl];
    }
    if (entry) entry.count -= 1;
    return entry?.count ?? 0;
  },
);

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get isReady() {
      return mocks.isReady;
    },
    eval: evalFake,
    del: mocks.del,
  },
}));

vi.mock("@/config/logger.js", () => ({
  logger: { warn: mocks.loggerWarn },
}));

const { RedisRateLimitStore, resetRateLimitStoreWarning } =
  await import("./redis-rate-limit-store.utils.js");
const { rateLimitBaseOptions } = await import("./rate-limit.utils.js");

const WINDOW = 10_000;

const storeFor = (name: string, windowMs = WINDOW) => {
  const store = new RedisRateLimitStore(name);
  store.init({ windowMs } as Options);
  return store;
};

const appWith = (
  store: InstanceType<typeof RedisRateLimitStore>,
  limit: number,
) => {
  const app = express();
  app.set("trust proxy", true);
  app.get(
    "/",
    rateLimit({
      ...rateLimitBaseOptions,
      windowMs: WINDOW,
      limit,
      store,
      keyGenerator: (req) => req.header("x-caller") ?? "anonymous",
      validate: false,
    }),
    (_req, res) => {
      res.json({ success: true });
    },
  );
  return app;
};

const call = (app: express.Express, caller: string) =>
  request(app).get("/").set("x-caller", caller);

describe("RedisRateLimitStore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    mocks.isReady = true;
    mocks.evalImpl = undefined;
    entries.clear();
    evalFake.mockClear();
    mocks.loggerWarn.mockReset().mockResolvedValue(undefined);
    mocks.del.mockReset().mockResolvedValue(1);
    resetRateLimitStoreWarning();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("with Redis healthy", () => {
    it("increments per key and runs the Lua script once per hit with the prefixed key", async () => {
      const store = storeFor("global");

      const first = await store.increment("1.2.3.4");
      const second = await store.increment("1.2.3.4");

      expect(first.totalHits).toBe(1);
      expect(second.totalHits).toBe(2);
      expect(evalFake).toHaveBeenCalledTimes(2);
      expect(evalFake).toHaveBeenCalledWith(RATE_LIMIT_INCREMENT_SCRIPT, {
        keys: ["rl:global:1.2.3.4"],
        arguments: [String(WINDOW)],
      });
      expect(second.resetTime!.getTime()).toBe(Date.now() + WINDOW);
    });

    it("returns the existing 429 response once the limit is reached", async () => {
      const app = appWith(storeFor("global"), 2);

      expect((await call(app, "a")).status).toBe(200);
      expect((await call(app, "a")).status).toBe(200);
      const blocked = await call(app, "a");

      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({
        success: false,
        message: "Too many requests. Please try again later.",
      });
      expect(blocked.headers["ratelimit-limit"]).toBe("2");
      expect(evalFake).toHaveBeenCalledTimes(3);
    });

    it("resets the count when the window expires", async () => {
      const store = storeFor("global");
      await store.increment("k");
      await store.increment("k");

      vi.setSystemTime(Date.now() + WINDOW + 1);
      const afterExpiry = await store.increment("k");

      expect(afterExpiry.totalHits).toBe(1);
    });

    it("isolates callers and limiters from each other", async () => {
      const a = storeFor("limiter-a");
      const b = storeFor("limiter-b");

      await a.increment("caller-1");
      await a.increment("caller-1");
      const otherCaller = await a.increment("caller-2");
      const otherLimiter = await b.increment("caller-1");

      expect(otherCaller.totalHits).toBe(1);
      expect(otherLimiter.totalHits).toBe(1);
      expect([...entries.keys()].sort()).toEqual([
        "rl:limiter-a:caller-1",
        "rl:limiter-a:caller-2",
        "rl:limiter-b:caller-1",
      ]);
    });

    it("decrements through Redis and resets a key", async () => {
      const store = storeFor("admin-login");
      await store.increment("k");
      await store.increment("k");

      await store.decrement("k");
      expect((await store.increment("k")).totalHits).toBe(2);

      await store.resetKey("k");
      expect(mocks.del).toHaveBeenCalledWith("rl:admin-login:k");
    });
  });

  describe("when Redis fails", () => {
    const failing = () => {
      mocks.evalImpl = () => {
        throw new Error("redis down");
      };
    };

    it("serves requests from the in-memory limiter and still limits", async () => {
      failing();
      const app = appWith(storeFor("global"), 2);

      expect((await call(app, "a")).status).toBe(200);
      expect((await call(app, "a")).status).toBe(200);
      const blocked = await call(app, "a");

      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe(
        "Too many requests. Please try again later.",
      );
      expect((await call(app, "b")).status).toBe(200);
    });

    it("logs rate_limit.store.error once per minute across several failures", async () => {
      failing();
      const store = storeFor("global");

      for (let i = 0; i < 5; i += 1) await store.increment("k");

      expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "rate_limit.store.error",
          attributes: expect.objectContaining({
            "error.message": expect.stringContaining("redis down"),
          }),
        }),
      );

      vi.setSystemTime(Date.now() + RATE_LIMIT_STORE_WARN_INTERVAL_MS - 1);
      await store.increment("k");
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 1);
      await store.increment("k");
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(2);
    });

    it("falls back without calling Redis while the client is not ready", async () => {
      mocks.isReady = false;
      const store = storeFor("global");

      const first = (await store.increment("k")).totalHits;
      const second = (await store.increment("k")).totalHits;

      expect(second).toBe(first + 1);
      expect(evalFake).not.toHaveBeenCalled();
    });

    it("falls back when Redis does not answer in time", async () => {
      mocks.evalImpl = () => new Promise(() => undefined);
      const store = storeFor("global");

      const pending = store.increment("k");
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_STORE_TIMEOUT_MS);
      const result = await pending;

      expect(result.totalHits).toBe(1);
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    });

    it("falls back on an unexpected script reply", async () => {
      mocks.evalImpl = () => "OK";
      const store = storeFor("global");

      expect((await store.increment("k")).totalHits).toBe(1);
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    });

    it("returns to Redis on the next request once it works again", async () => {
      failing();
      const store = storeFor("global");
      await store.increment("k");
      await store.increment("k");
      evalFake.mockClear();

      mocks.evalImpl = undefined;
      const recovered = await store.increment("k");

      expect(evalFake).toHaveBeenCalledTimes(1);
      expect(recovered.totalHits).toBe(1);
      expect(entries.get("rl:global:k")?.count).toBe(1);
    });

    it("does not throw from decrement or resetKey", async () => {
      failing();
      mocks.del.mockRejectedValue(new Error("redis down"));
      const store = storeFor("global");

      await expect(store.decrement("k")).resolves.toBeUndefined();
      await expect(store.resetKey("k")).resolves.toBeUndefined();
    });
  });
});
