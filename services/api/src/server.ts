import { createServer, type Server } from "node:http";
import { SERVICE_NAME } from "./config/constants.js";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { disconnectNats } from "./config/nats.js";
import {
  startNotificationConsumer,
  stopNotificationConsumer,
} from "./events/consumer.js";
import { initializeMessagingSocket } from "./modules/messaging/messaging.socket.js";
import { startPayoutCron } from "./modules/payouts/payouts.cron.js";

let server: Server | undefined;
let isShuttingDown = false;

const start = async (): Promise<void> => {
  await connectRedis();
  await startNotificationConsumer();

  server = createServer(app);
  initializeMessagingSocket(server);
  startPayoutCron();
  server.listen(env.port, () => {
    console.log(
      `${SERVICE_NAME} listening on http://localhost:${env.port} in ${env.nodeEnv} mode`,
    );
  });
};

const closeHttpServer = async (): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
      }

      resolve();
    });
  });
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received. Closing services.`);

  try {
    await closeHttpServer();
    await stopNotificationConsumer();
    await disconnectNats();
    await disconnectRedis();
    process.exit(0);
  } catch (error) {
    console.error("Failed to shut down cleanly.", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(async (error) => {
  console.error(`Failed to start ${SERVICE_NAME}.`, error);
  await disconnectRedis().catch(() => undefined);
  await disconnectNats().catch(() => undefined);
  process.exit(1);
});
