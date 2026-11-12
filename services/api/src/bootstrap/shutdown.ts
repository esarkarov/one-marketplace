import { logger, rootLogger } from "../config/logger.js";
import { pool } from "../database/client.js";
import { disconnectRedis } from "../infrastructure/redis.js";
import { closeRabbit } from "../infrastructure/rabbitmq.js";
import { stopNotificationConsumer } from "../modules/notifications/notifications.consumer.js";
import { closeMessagingSocket } from "../modules/messaging/messaging.socket.js";
import { stopPayoutCron } from "../modules/payouts/payouts.cron.js";
import { errorLogAttributes } from "../shared/utils/sanitize-log.js";
import { getHttpServer } from "./http-server.js";

let isShuttingDown = false;

export const SHUTDOWN_TIMEOUT_MS = 10_000;
const CONNECTION_GRACE_MS = 3_000;

const closeHttpServer = async (): Promise<void> => {
  const current = getHttpServer();
  if (!current) {
    return;
  }

  const socketClosed = closeMessagingSocket();
  const httpClosed = new Promise<void>((resolve, reject) => {
    current.close((error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      ) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  current.closeIdleConnections();
  const graceTimer = setTimeout(
    () => current.closeAllConnections(),
    CONNECTION_GRACE_MS,
  );

  try {
    await Promise.all([socketClosed, httpClosed]);
  } finally {
    clearTimeout(graceTimer);
  }
};

const flushLogs = (): Promise<void> =>
  new Promise((resolve) => {
    try {
      rootLogger.flush(() => resolve());
    } catch {
      resolve();
    }
  });

export const exitWithFlush = async (code: number): Promise<never> => {
  await flushLogs();
  process.exit(code);
};

export const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  await logger.info({
    message: "Shutdown signal received. Closing services.",
    eventName: "system.shutdown",
    attributes: { "process.signal": signal },
  });

  const forceExitTimer = setTimeout(() => {
    void logger
      .fatal({
        message: "Shutdown timed out. Forcing exit.",
        eventName: "system.shutdown.timeout",
      })
      .then(() => exitWithFlush(1));
  }, SHUTDOWN_TIMEOUT_MS);

  let failed = false;
  const runStep = async (
    name: string,
    step: () => Promise<void> | void,
  ): Promise<void> => {
    try {
      await step();
    } catch (error) {
      failed = true;
      await logger.error({
        message: `Shutdown step failed: ${name}`,
        eventName: "system.shutdown.step_failed",
        attributes: {
          "shutdown.step": name,
          "error.name": error instanceof Error ? error.name : "UnknownError",
          ...errorLogAttributes(error),
        },
      });
    }
  };

  await runStep("payout cron", stopPayoutCron);
  await runStep("http server", closeHttpServer);
  await runStep("notification consumer", () =>
    stopNotificationConsumer(CONNECTION_GRACE_MS),
  );
  await runStep("rabbitmq", () => closeRabbit(SHUTDOWN_TIMEOUT_MS));
  await runStep("redis", disconnectRedis);
  await runStep("database pool", () => pool.end());

  clearTimeout(forceExitTimer);
  await exitWithFlush(failed ? 1 : 0);
};
