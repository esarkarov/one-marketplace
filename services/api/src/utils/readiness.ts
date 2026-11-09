import { redis } from "../config/redis.js";
import { pool } from "../database/client.js";

export type CheckStatus = "ok" | "failed";

export interface ReadinessChecks {
  postgres: CheckStatus;
  redis: CheckStatus;
}

export type ReadinessFailureHandler = (
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

export const checkReadiness = async (
  onFailure?: ReadinessFailureHandler,
): Promise<ReadinessChecks> => {
  const [postgres, redisStatus] = await Promise.all([
    runCheck("postgres", () => pool.query("select 1"), onFailure),
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
