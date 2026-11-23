import { logger, rootLogger } from "@/config/logger.js";
import { pool } from "@/database/client.js";
import { disconnectRedis } from "@/infrastructure/cache/redis.client.js";
import { stopDeadLetterMonitor } from "@/infrastructure/events/notification.monitor.js";
import { closeRabbit } from "@/infrastructure/events/rabbitmq.client.js";
import {
  stopOrphanPaymentDetectionCron,
  stopRefundReconciliationCron,
  waitForOrphanPaymentDetectionRun,
  waitForRefundReconciliationRun,
} from "@/modules/contracts/index.js";
import { registerNotificationPusher } from "@/modules/notification-store/index.js";
import { stopNotificationConsumer } from "@/modules/notifications/notifications.consumer.js";
import { closeMessagingSocket } from "@/modules/messaging/messaging.socket.js";
import {
  stopPayoutCron,
  waitForPayoutRun,
} from "@/modules/payouts/payouts.cron.js";
import { closeAllSseStreams } from "@/middleware/utils/sse-streams.utils.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import { getHttpServer } from "./http-server.js";

let isShuttingDown = false;
let crashed = false;

export type ShutdownReason =
  NodeJS.Signals | "uncaughtException" | "unhandledRejection" | "serverError";

export const SHUTDOWN_TIMEOUT_MS = 10_000;
const CONNECTION_GRACE_MS = 3_000;
export const PAYOUT_DRAIN_TIMEOUT_MS =
  SHUTDOWN_TIMEOUT_MS - 2 * CONNECTION_GRACE_MS;

export const isShutdownInProgress = (): boolean => isShuttingDown;

export const markShutdownFailed = (): void => {
  crashed = true;
};

const drainRun = async (
  wait: () => Promise<void>,
  message: string,
  eventName: string,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), PAYOUT_DRAIN_TIMEOUT_MS);
  });
  try {
    const finished = wait().then(() => false);
    if (await Promise.race([finished, timedOut])) {
      await logger.warn({
        message,
        eventName,
        attributes: { "shutdown.timeout_ms": PAYOUT_DRAIN_TIMEOUT_MS },
      });
    }
  } finally {
    clearTimeout(timer);
  }
};

const drainPayoutRun = (): Promise<void> =>
  drainRun(
    waitForPayoutRun,
    "Payout run still in flight at shutdown. Continuing.",
    "system.shutdown.payout_run_timeout",
  );

const drainRefundReconciliationRun = (): Promise<void> =>
  drainRun(
    waitForRefundReconciliationRun,
    "Refund reconciliation run still in flight at shutdown. Continuing.",
    "system.shutdown.refund_reconciliation_run_timeout",
  );

const drainOrphanPaymentDetectionRun = (): Promise<void> =>
  drainRun(
    waitForOrphanPaymentDetectionRun,
    "Orphan payment detection run still in flight at shutdown. Continuing.",
    "system.shutdown.orphan_payment_detection_run_timeout",
  );

let httpClosed: Promise<Error | undefined> | undefined;

const stopAcceptingConnections = (): void => {
  const current = getHttpServer();
  if (!current || httpClosed) {
    return;
  }

  httpClosed = new Promise<Error | undefined>((resolve) => {
    current.close((error) => {
      const ignored =
        (error as NodeJS.ErrnoException | undefined)?.code ===
        "ERR_SERVER_NOT_RUNNING";
      resolve(ignored ? undefined : (error ?? undefined));
    });
  });
};

const closeSseStreams = (): void => {
  closeAllSseStreams();
  getHttpServer()?.closeIdleConnections?.();
};

const closeHttpServer = async (): Promise<void> => {
  const current = getHttpServer();
  if (!current) {
    return;
  }

  const socketClosed = closeMessagingSocket();
  stopAcceptingConnections();

  current.closeIdleConnections();
  const graceTimer = setTimeout(
    () => current.closeAllConnections(),
    CONNECTION_GRACE_MS,
  );

  try {
    await socketClosed;
    const error = await httpClosed;
    if (error) {
      throw error;
    }
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

export const shutdown = async (reason: ShutdownReason): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  await logger.info({
    message: "Shutdown signal received. Closing services.",
    eventName: "system.shutdown",
    attributes: { "process.signal": reason },
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

  await runStep("stop accepting connections", stopAcceptingConnections);
  await runStep("sse streams", closeSseStreams);
  await runStep("payout cron", stopPayoutCron);
  await runStep("refund reconciliation cron", () => {
    void stopOrphanPaymentDetectionCron();
    return stopRefundReconciliationCron();
  });
  await runStep("background runs", () =>
    Promise.all([
      drainPayoutRun(),
      drainRefundReconciliationRun(),
      drainOrphanPaymentDetectionRun(),
    ]).then(() => undefined),
  );
  await runStep("http server", closeHttpServer);
  registerNotificationPusher(null);
  await runStep("notification consumer", () =>
    stopNotificationConsumer(CONNECTION_GRACE_MS),
  );
  await runStep("dead letter monitor", stopDeadLetterMonitor);
  await runStep("rabbitmq", () => closeRabbit(SHUTDOWN_TIMEOUT_MS));
  await runStep("redis", disconnectRedis);
  await runStep("database pool", () => pool.end());

  clearTimeout(forceExitTimer);
  await exitWithFlush(failed || crashed ? 1 : 0);
};
