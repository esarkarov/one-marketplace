import type { Request, Response } from "express";
import { SERVICE_NAME } from "../../../config/constants.js";
import { errorLogAttributes } from "../../../shared/logging/sanitize-log.js";
import { defaultErrorCode } from "../../../shared/errors/api-error.js";
import { ApiResponse } from "../../../types/common.types.js";
import {
  checkReadiness,
  type ReadinessChecks,
} from "../services/health.service.js";

export const healthHandler = (_request: Request, response: Response) => {
  const body: ApiResponse<{
    service: string;
    status: "healthy";
    timestamp: string;
  }> = {
    success: true,
    message: "Service is healthy",
    data: {
      service: SERVICE_NAME,
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  };

  response.status(200).json(body);
};

export const readinessHandler = async (
  request: Request,
  response: Response,
) => {
  const failures: {
    check: string;
    attributes: ReturnType<typeof errorLogAttributes>;
  }[] = [];
  const checks = await checkReadiness((check, error) => {
    failures.push({ check, attributes: errorLogAttributes(error) });
  });
  const ready = checks.postgres === "ok" && checks.redis === "ok";

  for (const failure of failures) {
    try {
      await request.logger.warn({
        message: "Readiness check failed",
        eventName: "system.readiness.failed",
        attributes: {
          "readiness.check": failure.check,
          ...failure.attributes,
        },
      });
    } catch {}
  }

  const body: ApiResponse<{
    status: "ready" | "not_ready";
    checks: ReadinessChecks;
  }> & { code?: string } = {
    success: ready,
    message: ready ? "Service is ready" : "Service is not ready",
    data: { status: ready ? "ready" : "not_ready", checks },
    ...(ready
      ? {}
      : { code: defaultErrorCode(503), requestId: request.requestId }),
  };

  response.status(ready ? 200 : 503).json(body);
};
