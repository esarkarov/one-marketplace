import { createServer, type Server } from "node:http";
import { SERVICE_NAME } from "./config/constants.js";
import { env } from "./config/env.js";
import { logger, rootLogger } from "./config/logger.js";
import { app } from "./app.js";
import { errorLogAttributes } from "./utils/sanitize-log.js";
import { pool } from "./database/client.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { closeRabbit, isRabbitEnabled } from "./config/rabbitmq.js";
import {
  startNotificationConsumer,
  stopNotificationConsumer,
} from "./events/consumer.js";
import {
  closeMessagingSocket,
  initializeMessagingSocket,
} from "./modules/messaging/messaging.socket.js";
import {
  startPayoutCron,
  stopPayoutCron,
} from "./modules/payouts/payouts.cron.js";

let server: Server | undefined;
let isShuttingDown = false;

const start = async (): Promise<void> => {
  await connectRedis();
  if (isRabbitEnabled()) {
    await startNotificationConsumer();
  }

  server = createServer(app);
  initializeMessagingSocket(server);
  startPayoutCron();
  server.listen(env.port, () => {
    void logger.info({
      message: `${SERVICE_NAME} listening`,
      eventName: "system.startup",
      attributes: {
        "server.port": env.port,
        "service.environment": env.nodeEnv,
      },
    });
  });
};

const SHUTDOWN_TIMEOUT_MS = 10_000;
const CONNECTION_GRACE_MS = 3_000;

const closeHttpServer = async (): Promise<void> => {
  const current = server;
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

const exitWithFlush = async (code: number): Promise<never> => {
  await flushLogs();
  process.exit(code);
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
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

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(async (error) => {
  await logger.fatal({
    message: `Failed to start ${SERVICE_NAME}`,
    eventName: "system.startup.failed",
    attributes: {
      "error.name": error instanceof Error ? error.name : "UnknownError",
      ...errorLogAttributes(error),
    },
  });
  await disconnectRedis().catch(() => undefined);
  await closeRabbit(SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
  await exitWithFlush(1);
});
