import { logger } from "@/config/logger.js";
import {
  CACHE_COMMAND_TIMEOUT_MS,
  CACHE_DEGRADED_LOG_INTERVAL_MS,
} from "@/infrastructure/constants/index.js";
import { redis } from "./redis.client.js";
import { recordRedisDegraded } from "./redis-status.cache.js";

type CacheOperation = "get" | "setEx" | "expire";

let lastDegradedLogAt: number | undefined;

const namedError = (name: string, message: string): Error =>
  Object.assign(new Error(message), { name });

const markDegraded = (operation: CacheOperation, error: unknown): void => {
  recordRedisDegraded();
  const now = Date.now();
  if (
    lastDegradedLogAt !== undefined &&
    now - lastDegradedLogAt < CACHE_DEGRADED_LOG_INTERVAL_MS
  ) {
    return;
  }
  lastDegradedLogAt = now;
  void Promise.resolve()
    .then(() =>
      logger.warn({
        message: "Redis cache unavailable, continuing without it",
        eventName: "cache.redis.degraded",
        attributes: {
          "cache.op": operation,
          "error.name": error instanceof Error ? error.name : "UnknownError",
        },
      }),
    )
    .catch(() => undefined);
};

const runCommand = async <T>(
  operation: CacheOperation,
  command: () => Promise<T>,
): Promise<T | undefined> => {
  if (redis.isReady === false) {
    markDegraded(
      operation,
      namedError("RedisNotReadyError", "Redis client is not ready."),
    );
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(namedError("CacheTimeoutError", "Redis command timed out.")),
      CACHE_COMMAND_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([command(), timeout]);
  } catch (error) {
    markDegraded(operation, error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

export const cacheGet = async (key: string): Promise<string | null> => {
  const value = await runCommand("get", () => redis.get(key));
  return typeof value === "string" ? value : null;
};

export const cacheSetEx = async (
  key: string,
  ttlSeconds: number,
  value: string,
): Promise<void> => {
  await runCommand("setEx", () => redis.setEx(key, ttlSeconds, value));
};

export const cacheExpire = async (
  key: string,
  ttlSeconds: number,
): Promise<void> => {
  await runCommand("expire", () => redis.expire(key, ttlSeconds));
};
