import { rateLimit } from "express-rate-limit";
import type { Options } from "express-rate-limit";
import { env } from "../config/env.js";
import { WEBHOOK_PATHS } from "../config/webhooks.js";
import type { ApiResponse } from "../types/common.types.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const isTestEnvironment = () => env.nodeEnv === "test";

const handler: Options["handler"] = (request, response) => {
  response.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
    requestId: request.requestId,
  } satisfies ApiResponse<never>);
};

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
} as const;

const HEALTH_PATHS = new Set(["/health", "/ready"]);
const WEBHOOK_PATH_SET = new Set<string>(WEBHOOK_PATHS);

export const isRateLimitExempt = (method: string, path: string): boolean => {
  const upperMethod = method.toUpperCase();

  return (
    (upperMethod === "GET" && HEALTH_PATHS.has(path)) ||
    (upperMethod === "POST" && WEBHOOK_PATH_SET.has(path))
  );
};

export const globalLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
  skip: (request) =>
    isTestEnvironment() || isRateLimitExempt(request.method, request.path),
});

export const adminLoginLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  skipSuccessfulRequests: true,
  skip: isTestEnvironment,
});

export const adminLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 150,
  skip: isTestEnvironment,
});

export const PUBLIC_SEARCH_LIMIT = 60;
export const PUBLIC_SEARCH_WINDOW_MS = 60 * 1000;

export const publicSearchLimiter = rateLimit({
  ...baseOptions,
  windowMs: PUBLIC_SEARCH_WINDOW_MS,
  limit: PUBLIC_SEARCH_LIMIT,
  skip: isTestEnvironment,
});

export const signUpLimiter = rateLimit({
  ...baseOptions,
  windowMs: ONE_HOUR,
  limit: 10,
  skip: isTestEnvironment,
});
