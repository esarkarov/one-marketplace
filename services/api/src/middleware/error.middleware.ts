import { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";
import { ApiResponse } from "../types/common.types.js";
import { errorLogAttributes, sanitizeForLog } from "../utils/sanitize-log.js";

const STACK_LIMIT = 2000;

const stackWithoutMessage = (error: Error): string => {
  const stack = error.stack ?? "";
  return error.message ? stack.replace(error.message, "") : stack;
};

const resolveStatusCode = (error: unknown): number => {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    (error as { expose?: unknown }).expose === true
  ) {
    const candidate =
      (error as { status?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode;

    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate < 500
    ) {
      return candidate;
    }
  }

  return 500;
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const statusCode = resolveStatusCode(error);

  if (statusCode >= 500) {
    (request.logger ?? logger)
      .error({
        message: "Unhandled request error",
        eventName: "system.request.failed",
        attributes: {
          "http.route": request.path,
          "http.method": request.method,
          "http.status_code": statusCode,
          "request.id": request.requestId,
          "error.type": error instanceof Error ? error.name : "unknown",
          "error.name": error instanceof Error ? error.name : "unknown",
          ...errorLogAttributes(error),
          "error.stack":
            error instanceof Error
              ? sanitizeForLog(stackWithoutMessage(error)).slice(0, STACK_LIMIT)
              : "",
        },
      })
      .catch(() => {});

    response.status(statusCode).json({
      success: false,
      message: "Internal server error.",
      requestId: request.requestId,
    } satisfies ApiResponse<never>);
    return;
  }

  const message =
    error instanceof Error ? error.message : "Request could not be processed.";

  response.status(statusCode).json({
    success: false,
    message,
  } satisfies ApiResponse<never>);
};
