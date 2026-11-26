import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LogFn = (entry: { eventName: string }) => Promise<void>;

const hoisted = vi.hoisted(() => ({
  info: vi.fn<LogFn>(),
  error: vi.fn<LogFn>(),
  warn: vi.fn<LogFn>(),
}));

vi.mock("@/config/logger.js", () => ({ logger: hoisted }));

import {
  REDIS_QUIT_TIMEOUT_MS,
  REDIS_RECONNECT_JITTER_MS,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_STARTUP_DEADLINE_MS,
} from "@/infrastructure/constants/index.js";
import {
  connectRedis,
  disconnectRedis,
  redis,
  redisReconnectStrategy,
} from "./redis.client.js";

const recoveredLogs = () =>
  hoisted.info.mock.calls.filter(
    ([entry]) => entry.eventName === "cache.redis.recovered",
  );

beforeEach(() => {
  for (const fn of Object.values(hoisted)) {
    fn.mockReset().mockResolvedValue(undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("redisReconnectStrategy", () => {
  it("never gives up for retries 0 to 1000", () => {
    for (let retries = 0; retries <= 1000; retries += 1) {
      const delay = redisReconnectStrategy(retries);
      expect(typeof delay).toBe("number");
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThan(
        REDIS_RECONNECT_MAX_DELAY_MS + REDIS_RECONNECT_JITTER_MS,
      );
    }
  });

  it("doubles from 100 ms and caps at 5 s before jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect([0, 1, 2, 3, 5, 6, 20].map(redisReconnectStrategy)).toEqual([
      100, 200, 400, 800, 3200, 5000, 5000,
    ]);
  });

  it("adds 0 to 99 ms of jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    expect(redisReconnectStrategy(0)).toBe(199);
    expect(redisReconnectStrategy(50)).toBe(5099);
  });
});

describe("connectRedis", () => {
  it("rejects once the startup deadline passes when Redis never becomes ready", async () => {
    vi.useFakeTimers();
    vi.spyOn(redis, "isOpen", "get").mockReturnValue(false);
    const connect = vi
      .spyOn(redis, "connect")
      .mockReturnValue(new Promise<never>(() => undefined));

    const result = connectRedis().then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(REDIS_STARTUP_DEADLINE_MS - 1);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const outcome = await result;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(
      "Redis did not become ready in time.",
    );
  });
});

describe("disconnectRedis", () => {
  it("quits a ready client", async () => {
    vi.spyOn(redis, "isReady", "get").mockReturnValue(true);
    const quit = vi.spyOn(redis, "quit").mockResolvedValue("OK");
    const destroy = vi.spyOn(redis, "destroy").mockReturnValue(undefined);

    await disconnectRedis();

    expect(quit).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("destroys a ready client whose quit does not finish in time and rejects", async () => {
    vi.useFakeTimers();
    vi.spyOn(redis, "isReady", "get").mockReturnValue(true);
    vi.spyOn(redis, "quit").mockReturnValue(
      new Promise<never>(() => undefined),
    );
    const destroy = vi.spyOn(redis, "destroy").mockReturnValue(undefined);

    const result = disconnectRedis().then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS - 1);
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const outcome = await result;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("Redis did not close in time.");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys an open client that never became ready instead of waiting on quit", async () => {
    vi.spyOn(redis, "isReady", "get").mockReturnValue(false);
    vi.spyOn(redis, "isOpen", "get").mockReturnValue(true);
    const quit = vi.spyOn(redis, "quit").mockResolvedValue("OK");
    const destroy = vi.spyOn(redis, "destroy").mockReturnValue(undefined);

    await disconnectRedis();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("does nothing for a client that was never opened", async () => {
    vi.spyOn(redis, "isReady", "get").mockReturnValue(false);
    vi.spyOn(redis, "isOpen", "get").mockReturnValue(false);
    const quit = vi.spyOn(redis, "quit").mockResolvedValue("OK");
    const destroy = vi.spyOn(redis, "destroy").mockReturnValue(undefined);

    await disconnectRedis();

    expect(quit).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe("recovery log", () => {
  it("logs cache.redis.recovered on ready only after a recorded degradation", () => {
    redis.emit("ready");
    expect(recoveredLogs()).toHaveLength(0);

    redis.emit("error", new Error("connection lost"));
    redis.emit("ready");
    expect(recoveredLogs()).toHaveLength(1);

    redis.emit("ready");
    expect(recoveredLogs()).toHaveLength(1);
  });
});
