import { db } from "../../../database/client.js";
import { redis } from "../../../infrastructure/cache/redis.js";
import { getRabbitStatus } from "../../../infrastructure/events/rabbitmq.js";
import { logger } from "../../../config/logger.js";
import { errorLogAttributes } from "../../../shared/logging/sanitize-log.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import {
  isAllowedRedisKey,
  REDIS_REDACTED_PREFIX,
  REDIS_REDACTED_VALUE,
} from "../schemas/admin.redis.schema.js";
import { pingDatabase } from "../repositories/admin.repository.js";

export const getSystemHealth = async () => {
  const startedAt = Date.now();

  const [redisResult, dbResult, rabbitResult] = await Promise.allSettled([
    (async () => {
      const start = Date.now();
      await redis.ping();
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      await pingDatabase(db);
      return { ok: true, latencyMs: Date.now() - start };
    })(),
    getRabbitStatus(),
  ]);

  const settle = async (
    result: PromiseSettledResult<{ ok: boolean; latencyMs: number }>,
    eventName: string,
    message: string,
  ): Promise<{ ok: boolean; latencyMs?: number }> => {
    if (result.status === "fulfilled") return result.value;
    await Promise.resolve()
      .then(() =>
        logger.error({
          message,
          eventName,
          attributes: errorLogAttributes(result.reason),
        }),
      )
      .catch(() => undefined);
    return { ok: false };
  };

  return {
    redis: await settle(
      redisResult,
      "admin.health.redis_failed",
      "Redis health check failed",
    ),
    database: await settle(
      dbResult,
      "admin.health.database_failed",
      "Database health check failed",
    ),
    rabbitmq:
      rabbitResult.status === "fulfilled" ? rabbitResult.value : { ok: false },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      loadAverage: (await import("os")).loadavg(),
      cpuCount: (await import("os")).cpus().length,
      totalMemoryMb: Math.round((await import("os")).totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round((await import("os")).freemem() / 1024 / 1024),
      nodeVersion: process.version,
    },
    checkedAt: new Date(startedAt).toISOString(),
  };
};

const MAX_SCAN_KEYS = 200;

export const scanRedisKeys = async (pattern: string) => {
  if (!isAllowedRedisKey(pattern)) {
    throw new ApiError(400, "Invalid request.");
  }
  const keys: string[] = [];
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    keys.push(...result.keys.filter(isAllowedRedisKey));
  } while (cursor !== "0" && keys.length < MAX_SCAN_KEYS);

  const preview = keys.slice(0, MAX_SCAN_KEYS);
  const details = await Promise.all(
    preview.map(async (key) => {
      const [type, ttl] = await Promise.all([redis.type(key), redis.ttl(key)]);
      return { key, type, ttl };
    }),
  );

  return { keys: details, truncated: keys.length >= MAX_SCAN_KEYS };
};

const MAX_VALUE_PREVIEW = 5_000;

export const getRedisKeyValue = async (key: string) => {
  if (!isAllowedRedisKey(key)) {
    throw new ApiError(403, "Access to this Redis key is not allowed.");
  }
  const type = await redis.type(key);
  let value: unknown;

  switch (type) {
    case "string":
      value = await redis.get(key);
      break;
    case "hash":
      value = await redis.hGetAll(key);
      break;
    case "list":
      value = await redis.lRange(key, 0, 100);
      break;
    case "set":
      value = await redis.sMembers(key);
      break;
    case "zset":
      value = await redis.zRangeWithScores(key, 0, 100);
      break;
    case "none":
      return { type, ttl: -2, value: null };
    default:
      value = `<unsupported type: ${type}>`;
  }

  if (key.startsWith(REDIS_REDACTED_PREFIX)) {
    value = REDIS_REDACTED_VALUE;
  }

  const serialized = JSON.stringify(value);
  const truncated = serialized.length > MAX_VALUE_PREVIEW;
  const ttl = await redis.ttl(key);

  return {
    type,
    ttl,
    value: truncated ? serialized.slice(0, MAX_VALUE_PREVIEW) : value,
    truncated,
  };
};
