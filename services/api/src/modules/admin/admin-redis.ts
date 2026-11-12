import { z } from "zod";
import { ADMIN_LIMITS } from "../../shared/validation/validation-limits.js";

export const REDIS_ALLOWED_PREFIXES = [
  "account:auth:",
  "connects:",
  "webhook:daily:",
] as const;

export const REDIS_REDACTED_PREFIX = "account:auth:";
export const REDIS_REDACTED_VALUE = "[REDACTED]";

const PATTERN_CHARS = /^[A-Za-z0-9:_*?-]+$/;
const KEY_CHARS = /^[A-Za-z0-9:_-]+$/;

export const isAllowedRedisKey = (key: string): boolean =>
  REDIS_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));

export const redisScanQuerySchema = z.strictObject({
  pattern: z
    .string()
    .max(ADMIN_LIMITS.redisPattern)
    .regex(PATTERN_CHARS)
    .refine(isAllowedRedisKey),
});

export const redisKeyParamsSchema = z.strictObject({
  key: z.string().min(1).max(ADMIN_LIMITS.redisKey).regex(KEY_CHARS),
});
