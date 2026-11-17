import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import {
  CONTENT_WRITE_LIMIT,
  FIFTEEN_MINUTES,
  INVITE_WRITE_LIMIT,
  INVITE_WRITE_WINDOW_MS,
  MESSAGE_WRITE_LIMIT,
} from "../constants/rate-limit.constants.js";
import { rateLimitBaseOptions } from "../utils/rate-limit.utils.js";
import { createRedisRateLimitStore } from "../utils/redis-rate-limit-store.utils.js";

interface UserRateLimitOptions {
  name: string;
  limit: number;
  windowMs?: number;
}

export const createUserRateLimiter = ({
  name,
  limit,
  windowMs = FIFTEEN_MINUTES,
}: UserRateLimitOptions) =>
  rateLimit({
    windowMs,
    limit,
    ...rateLimitBaseOptions,
    store: createRedisRateLimitStore(name),
    skip: () => env.nodeEnv === "test",
    keyGenerator: (request) =>
      request.auth?.userId ??
      request.authClaims?.userId ??
      ipKeyGenerator(request.ip ?? ""),
  });

export const inviteWriteLimiter = createUserRateLimiter({
  name: "agency-invite-write",
  limit: INVITE_WRITE_LIMIT,
  windowMs: INVITE_WRITE_WINDOW_MS,
});

export const messageWriteLimiter = (name: string) =>
  createUserRateLimiter({ name, limit: MESSAGE_WRITE_LIMIT });

export const contentWriteLimiter = (name: string) =>
  createUserRateLimiter({ name, limit: CONTENT_WRITE_LIMIT });
