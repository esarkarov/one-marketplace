import { createServer, type Server } from "node:http";
import { SERVICE_NAME } from "@/config/constants.js";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { app } from "@/app.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import {
  connectRedis,
  disconnectRedis,
} from "@/infrastructure/cache/redis.client.js";
import {
  closeRabbit,
  isRabbitEnabled,
} from "@/infrastructure/events/rabbitmq.client.js";
import { pingDatabase } from "@/modules/health/index.js";
import { registerNotificationsPush } from "@/modules/notifications/services/notifications.push.service.js";
import { startNotificationConsumer } from "@/modules/notifications/notifications.consumer.js";
import { initializeMessagingSocket } from "@/modules/messaging/messaging.socket.js";
import {
  startOrphanPaymentDetectionCron,
  startRefundReconciliationCron,
} from "@/modules/contracts/index.js";
import { startPayoutCron } from "@/modules/payouts/payouts.cron.js";
import { handleFatalError } from "./crash-handlers.js";
import { setHttpServer } from "./http-server.js";
import { exitWithFlush, SHUTDOWN_TIMEOUT_MS } from "./shutdown.js";

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    let listening = false;
    server.on("error", (error) => {
      if (!listening) {
        reject(error);
        return;
      }

      void handleFatalError("serverError", error);
    });
    server.listen(env.port, () => {
      listening = true;
      resolve();
    });
  });

export const start = async (): Promise<void> => {
  await pingDatabase();
  await connectRedis();

  const server = createServer(app);
  setHttpServer(server);
  await listen(server);

  registerNotificationsPush();
  if (isRabbitEnabled()) {
    await startNotificationConsumer();
  }
  initializeMessagingSocket(server);
  startPayoutCron();
  startRefundReconciliationCron();
  startOrphanPaymentDetectionCron();
  void logger.info({
    message: `${SERVICE_NAME} listening`,
    eventName: "system.startup",
    attributes: {
      "server.port": env.port,
      "service.environment": env.nodeEnv,
    },
  });
};

export const handleStartupFailure = async (error: unknown): Promise<void> => {
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
};
