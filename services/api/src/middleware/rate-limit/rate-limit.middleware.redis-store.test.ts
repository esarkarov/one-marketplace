import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectRedis,
  disconnectRedis,
  redis,
} from "@/infrastructure/cache/redis.client.js";
import { RedisRateLimitStore } from "@/middleware/utils/redis-rate-limit-store.utils.js";

const RUN = `it-${randomUUID()}`;
const WINDOW = 60_000;

const storeFor = (name: string) => {
  const store = new RedisRateLimitStore(`${RUN}-${name}`);
  store.init({ windowMs: WINDOW } as Parameters<
    RedisRateLimitStore["init"]
  >[0]);
  return store;
};

const cleanup = async () => {
  const keys = await redis.keys(`rl:${RUN}-*`);
  if (keys.length) await redis.del(keys);
};

beforeAll(async () => {
  await connectRedis();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await disconnectRedis();
});

describe("RedisRateLimitStore against real Redis", () => {
  it("counts atomically under concurrency and sets the window ttl once", async () => {
    const store = storeFor("count");

    const results = await Promise.all(
      Array.from({ length: 25 }, () => store.increment("caller")),
    );

    expect(results.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    const ttl = await redis.pTTL(`rl:${RUN}-count:caller`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW);
  });

  it("keeps limiters and callers isolated and supports decrement and reset", async () => {
    const a = storeFor("iso-a");
    const b = storeFor("iso-b");

    await a.increment("one");
    await a.increment("one");
    expect((await a.increment("two")).totalHits).toBe(1);
    expect((await b.increment("one")).totalHits).toBe(1);

    await a.decrement("one");
    expect((await a.increment("one")).totalHits).toBe(2);

    await a.resetKey("one");
    expect((await a.increment("one")).totalHits).toBe(1);
  });

  it("does not create a key when decrementing an unknown caller", async () => {
    const store = storeFor("dec");

    await store.decrement("ghost");

    expect(await redis.exists(`rl:${RUN}-dec:ghost`)).toBe(0);
  });
});
