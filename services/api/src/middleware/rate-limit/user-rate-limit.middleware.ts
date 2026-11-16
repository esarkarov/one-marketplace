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

interface UserRateLimitOptions {
  limit: number;
  windowMs?: number;
}

export const createUserRateLimiter = ({
  limit,
  windowMs = FIFTEEN_MINUTES,
}: UserRateLimitOptions) =>
  rateLimit({
    windowMs,
    limit,
    ...rateLimitBaseOptions,
    skip: () => env.nodeEnv === "test",
    keyGenerator: (request) =>
      request.auth?.userId ??
      request.authClaims?.userId ??
      ipKeyGenerator(request.ip ?? ""),
  });

export const inviteWriteLimiter = createUserRateLimiter({
  limit: INVITE_WRITE_LIMIT,
  windowMs: INVITE_WRITE_WINDOW_MS,
});

export const messageWriteLimiter = () =>
  createUserRateLimiter({ limit: MESSAGE_WRITE_LIMIT });

export const contentWriteLimiter = () =>
  createUserRateLimiter({ limit: CONTENT_WRITE_LIMIT });
