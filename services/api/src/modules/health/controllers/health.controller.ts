import type { Request, Response } from "express";
import { SERVICE_NAME } from "../../../config/constants.js";
import { redis } from "../../../infrastructure/cache/redis.client.js";
import { errorLogAttributes } from "../../../shared/logging/sanitize-log.js";
import { defaultErrorCode } from "../../../shared/errors/api-error.js";
import { ApiResponse } from "../../../types/common.types.js";
import { pingDatabase } from "../repositories/health.repository.js";

type CheckStatus = "ok" | "failed";

interface ReadinessChecks {
  postgres: CheckStatus;
  redis: CheckStatus;
}

type ReadinessFailureHandler = (
  check: keyof ReadinessChecks,
  error: Error,
) => void;

const CHECK_TIMEOUT_MS = 2_000;

const withTimeout = async (task: () => Promise<unknown>): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Readiness check timed out."));
    }, CHECK_TIMEOUT_MS);
  });

  try {
    await Promise.race([task(), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const runCheck = async (
  name: keyof ReadinessChecks,
  task: () => Promise<unknown>,
  onFailure?: ReadinessFailureHandler,
): Promise<CheckStatus> => {
  try {
    await withTimeout(task);
    return "ok";
  } catch (error) {
    try {
      onFailure?.(
        name,
        error instanceof Error ? error : new Error("Unknown failure."),
      );
    } catch {}
    return "failed";
  }
};

const checkReadiness = async (
  onFailure?: ReadinessFailureHandler,
): Promise<ReadinessChecks> => {
  const [postgres, redisStatus] = await Promise.all([
    runCheck("postgres", () => pingDatabase(), onFailure),
    runCheck(
      "redis",
      async () => {
        if (!redis.isOpen || !redis.isReady) {
          throw new Error("Redis client is not open.");
        }
        await redis.ping();
      },
      onFailure,
    ),
  ]);

  return { postgres, redis: redisStatus };
};

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
