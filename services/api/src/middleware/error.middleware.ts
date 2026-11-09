import { ErrorRequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";
import { ApiResponse } from "../types/common.types.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  const statusCode = error instanceof ApiError ? error?.statusCode : 500;
  const message =
    error instanceof Error ? error.message : "An unexpted error occured.";

  if (statusCode >= 500) {
    request.logger
      .error({
        message: "Unhandled request error",
        eventName: "system.request.failed",
        attributes: {
          "http.route": request.path,
          "http.method": request.method,
          "http.status_code": statusCode,
          "error.type": error instanceof Error ? error.name : "unknown",
        },
      })
      .catch(() => {});
  }

  response.status(statusCode).json({
    success: false,
    message,
  } satisfies ApiResponse<never>);
};
