import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import {
  FIFTEEN_MINUTES,
  ONE_HOUR,
  PUBLIC_SEARCH_LIMIT,
  PUBLIC_SEARCH_WINDOW_MS,
} from "../constants/rate-limit.constants.js";
import {
  isRateLimitExempt,
  rateLimitBaseOptions,
} from "../utils/rate-limit.utils.js";

const isTestEnvironment = () => env.nodeEnv === "test";

export const globalLimiter = rateLimit({
  ...rateLimitBaseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
  skip: (request) =>
    isTestEnvironment() || isRateLimitExempt(request.method, request.path),
});

export const adminLoginLimiter = rateLimit({
  ...rateLimitBaseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  skipSuccessfulRequests: true,
  skip: isTestEnvironment,
});

export const adminLimiter = rateLimit({
  ...rateLimitBaseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 150,
  skip: isTestEnvironment,
});

export const publicSearchLimiter = rateLimit({
  ...rateLimitBaseOptions,
  windowMs: PUBLIC_SEARCH_WINDOW_MS,
  limit: PUBLIC_SEARCH_LIMIT,
  skip: isTestEnvironment,
});

export const signUpLimiter = rateLimit({
  ...rateLimitBaseOptions,
  windowMs: ONE_HOUR,
  limit: 10,
  skip: isTestEnvironment,
});
