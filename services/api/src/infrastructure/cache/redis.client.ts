import { createClient } from "redis";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import {
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_QUIT_TIMEOUT_MS,
  REDIS_RECONNECT_BASE_DELAY_MS,
  REDIS_RECONNECT_JITTER_MS,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_STARTUP_DEADLINE_MS,
} from "@/infrastructure/constants/index.js";
import {
  consumeRedisDegraded,
  recordRedisDegraded,
} from "./redis-status.cache.js";

export const redisReconnectStrategy = (retries: number): number =>
  Math.min(
    REDIS_RECONNECT_BASE_DELAY_MS * 2 ** retries,
    REDIS_RECONNECT_MAX_DELAY_MS,
  ) + Math.floor(Math.random() * REDIS_RECONNECT_JITTER_MS);

export const redis = createClient({
  url: env.redisUrl,
  disableOfflineQueue: true,
  socket: {
    reconnectStrategy: redisReconnectStrategy,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  },
});

redis.on("error", (error) => {
  recordRedisDegraded();
  void logger.error({
    message: "Redis client error",
    eventName: "redis.error",
    attributes: {
      "error.name": error instanceof Error ? error.name : "UnknownError",
      ...errorLogAttributes(error),
    },
  });
});

redis.on("ready", () => {
  if (!consumeRedisDegraded()) return;
  void logger.info({
    message: "Redis cache recovered",
    eventName: "cache.redis.recovered",
  });
});

const withDeadline = async <T>(
  operation: Promise<T>,
  deadlineMs: number,
  message: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), deadlineMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

export const connectRedis = async (): Promise<void> => {
  await withDeadline(
    (async () => {
      if (!redis.isOpen) {
        await redis.connect();
      }
      await redis.ping();
    })(),
    REDIS_STARTUP_DEADLINE_MS,
    "Redis did not become ready in time.",
  );
  await logger.info({
    message: "Redis connected",
    eventName: "redis.connected",
    attributes: { "redis.host": new URL(env.redisUrl).host },
  });
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis.isReady) {
    try {
      await withDeadline(
        redis.quit(),
        REDIS_QUIT_TIMEOUT_MS,
        "Redis did not close in time.",
      );
    } catch (error) {
      redis.destroy();
      throw error;
    }
    return;
  }
  if (redis.isOpen) {
    redis.destroy();
  }
};
