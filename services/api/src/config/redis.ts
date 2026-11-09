import { createClient } from "redis";
import { env } from "./env.js";

export const redis = createClient({
  password: env.redis.password,
  database: env.redis.database,
  socket: {
    host: env.redis.host,
    port: env.redis.port,
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
  console.log(
    `Redis connected at ${env.redis.host}:${env.redis.port}/${env.redis.database}.`,
  );
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    await redis.quit();
  }
};
