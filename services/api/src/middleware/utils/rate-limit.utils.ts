import { WEBHOOK_PATHS } from "../../config/constants.js";
import type { Options } from "express-rate-limit";
import type { ApiResponse } from "../../types/common.types.js";

const handler: Options["handler"] = (request, response) => {
  response.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
    requestId: request.requestId,
  } satisfies ApiResponse<never>);
};

export const rateLimitBaseOptions = {
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
