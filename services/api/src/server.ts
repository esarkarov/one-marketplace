import { createServer, type Server } from "node:http";
import { SERVICE_NAME } from "./config/constants.js";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { pool } from "./database/client.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { disconnectNats, isNatsEnabled } from "./config/nats.js";
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
  if (isNatsEnabled()) {
    await startNotificationConsumer();
  }

  server = createServer(app);
  initializeMessagingSocket(server);
  startPayoutCron();
  server.listen(env.port, () => {
    console.log(
      `${SERVICE_NAME} listening on http://localhost:${env.port} in ${env.nodeEnv} mode`,
    );
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

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received. Closing services.`);

  const forceExitTimer = setTimeout(() => {
    console.error("Shutdown timed out. Forcing exit.");
    process.exit(1);
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
      console.error(`Shutdown step failed: ${name}.`, error);
    }
  };

  await runStep("payout cron", stopPayoutCron);
  await runStep("http server", closeHttpServer);
  await runStep("notification consumer", stopNotificationConsumer);
  await runStep("nats", disconnectNats);
  await runStep("redis", disconnectRedis);
  await runStep("database pool", () => pool.end());

  clearTimeout(forceExitTimer);
  process.exit(failed ? 1 : 0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(async (error) => {
  console.error(`Failed to start ${SERVICE_NAME}.`, error);
  await disconnectRedis().catch(() => undefined);
  await disconnectNats().catch(() => undefined);
  process.exit(1);
});
