import { createClient } from "redis";
import { env } from "./env.js";

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
  console.error("Redis client error.", error);
});

export const connectRedis = async (): Promise<void> => {
  if (!redis.isOpen) {
    await redis.connect();
  }

  await redis.ping();
  console.log(`Redis connected at ${new URL(env.redisUrl).host}.`);
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    await redis.quit();
  }
};
