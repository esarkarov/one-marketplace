import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Options } from "express-rate-limit";
import { env } from "../config/env.js";
import type { ApiResponse } from "../types/common.types.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const MESSAGE_WRITE_LIMIT = 120;
export const CONTENT_WRITE_LIMIT = 30;

const handler: Options["handler"] = (request, response) => {
  response.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
    requestId: request.requestId,
  } satisfies ApiResponse<never>);
};

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
    standardHeaders: true,
    legacyHeaders: false,
    handler,
    skip: () => env.nodeEnv === "test",
    keyGenerator: (request) =>
      request.authClaims?.userId ?? ipKeyGenerator(request.ip ?? ""),
  });

export const messageWriteLimiter = () =>
  createUserRateLimiter({ limit: MESSAGE_WRITE_LIMIT });

export const contentWriteLimiter = () =>
  createUserRateLimiter({ limit: CONTENT_WRITE_LIMIT });
