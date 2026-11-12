import { createServer } from "node:http";
import { SERVICE_NAME } from "../config/constants.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { app } from "../app.js";
import { errorLogAttributes } from "../shared/utils/sanitize-log.js";
import { connectRedis, disconnectRedis } from "../infrastructure/redis.js";
import { closeRabbit, isRabbitEnabled } from "../infrastructure/rabbitmq.js";
import { startNotificationConsumer } from "../modules/notifications/notifications.consumer.js";
import { initializeMessagingSocket } from "../modules/messaging/messaging.socket.js";
import { startPayoutCron } from "../modules/payouts/payouts.cron.js";
import { setHttpServer } from "./http-server.js";
import { exitWithFlush, SHUTDOWN_TIMEOUT_MS } from "./shutdown.js";

export const start = async (): Promise<void> => {
  await connectRedis();
  if (isRabbitEnabled()) {
    await startNotificationConsumer();
  }

  const server = createServer(app);
  setHttpServer(server);
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
