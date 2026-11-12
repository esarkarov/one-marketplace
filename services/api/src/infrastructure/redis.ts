import { createClient } from "redis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { errorLogAttributes } from "../shared/logging/sanitize-log.js";

export const redis = createClient({
  url: env.redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries >= 10) {
        return new Error("Redis reconnect attempts exhausted.");
      }

      return Math.min(100 * 2 ** retries, 3_000);
    },
  },
});

redis.on("error", (error) => {
  void logger.error({
    message: "Redis client error",
    eventName: "redis.error",
    attributes: {
      "error.name": error instanceof Error ? error.name : "UnknownError",
      ...errorLogAttributes(error),
    },
  });
});

export const connectRedis = async (): Promise<void> => {
  if (!redis.isOpen) {
    await redis.connect();
  }

  await redis.ping();
  await logger.info({
    message: "Redis connected",
    eventName: "redis.connected",
    attributes: { "redis.host": new URL(env.redisUrl).host },
  });
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    await redis.quit();
  }
};
