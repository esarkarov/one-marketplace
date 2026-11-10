import { z } from "zod";

export const REDIS_ALLOWED_PREFIXES = [
  "account:auth:",
  "connects:",
  "webhook:daily:",
] as const;

export const REDIS_REDACTED_PREFIX = "account:auth:";
export const REDIS_REDACTED_VALUE = "[REDACTED]";

const MAX_PATTERN_LENGTH = 64;
const MAX_KEY_LENGTH = 128;
const PATTERN_CHARS = /^[A-Za-z0-9:_*?-]+$/;
const KEY_CHARS = /^[A-Za-z0-9:_-]+$/;

export const isAllowedRedisKey = (key: string): boolean =>
  REDIS_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));

export const redisScanQuerySchema = z.object({
  pattern: z
    .string()
    .max(MAX_PATTERN_LENGTH)
    .regex(PATTERN_CHARS)
    .refine(isAllowedRedisKey),
});

export const redisKeyParamsSchema = z.object({
  key: z.string().min(1).max(MAX_KEY_LENGTH).regex(KEY_CHARS),
});
