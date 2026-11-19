import { rateLimit } from "express-rate-limit";
import { env } from "@/config/env.js";
import {
  FIFTEEN_MINUTES,
  ONE_HOUR,
  PUBLIC_SEARCH_LIMIT,
  PUBLIC_SEARCH_WINDOW_MS,
} from "@/middleware/constants/rate-limit.constants.js";
import {
  isRateLimitExempt,
  rateLimitBaseOptions,
} from "@/middleware/utils/rate-limit.utils.js";
import { createRedisRateLimitStore } from "@/middleware/utils/redis-rate-limit-store.utils.js";

const isTestEnvironment = () => env.nodeEnv === "test";

export const globalLimiter = rateLimit({
  ...rateLimitBaseOptions,
  store: createRedisRateLimitStore("global"),
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
  skip: (request) =>
    isTestEnvironment() || isRateLimitExempt(request.method, request.path),
});

export const adminLoginLimiter = rateLimit({
  ...rateLimitBaseOptions,
  store: createRedisRateLimitStore("admin-login"),
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  skipSuccessfulRequests: true,
  skip: isTestEnvironment,
});

export const adminLimiter = rateLimit({
  ...rateLimitBaseOptions,
  store: createRedisRateLimitStore("admin"),
  windowMs: FIFTEEN_MINUTES,
  limit: 150,
  skip: isTestEnvironment,
});

export const publicSearchLimiter = rateLimit({
  ...rateLimitBaseOptions,
  store: createRedisRateLimitStore("public-search"),
  windowMs: PUBLIC_SEARCH_WINDOW_MS,
  limit: PUBLIC_SEARCH_LIMIT,
  skip: isTestEnvironment,
});

export const signUpLimiter = rateLimit({
  ...rateLimitBaseOptions,
  store: createRedisRateLimitStore("sign-up"),
  windowMs: ONE_HOUR,
  limit: 10,
  skip: isTestEnvironment,
});
