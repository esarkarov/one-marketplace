import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  pingDatabase: vi.fn(),
  connectRedis: vi.fn(),
  isRabbitEnabled: vi.fn(),
  startNotificationConsumer: vi.fn(),
  stopNotificationConsumer: vi.fn(),
  startDeadLetterMonitor: vi.fn(),
  stopDeadLetterMonitor: vi.fn(),
  initializeMessagingSocket: vi.fn(),
  startPayoutCron: vi.fn(),
  startRefundReconciliationCron: vi.fn(),
  registerNotificationsPush: vi.fn(),
  handleFatalError: vi.fn(),
  exitWithFlush: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("node:http", () => ({ createServer: hoisted.createServer }));
vi.mock("@/app.js", () => ({ app: {} }));
vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    fatal: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/modules/health/index.js", () => ({
  pingDatabase: hoisted.pingDatabase,
}));
vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  connectRedis: hoisted.connectRedis,
  disconnectRedis: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/infrastructure/events/rabbitmq.client.js", () => ({
  isRabbitEnabled: hoisted.isRabbitEnabled,
  closeRabbit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/infrastructure/events/notification.monitor.js", () => ({
  startDeadLetterMonitor: hoisted.startDeadLetterMonitor,
  stopDeadLetterMonitor: hoisted.stopDeadLetterMonitor,
}));
vi.mock("@/modules/notifications/notifications.consumer.js", () => ({
  startNotificationConsumer: hoisted.startNotificationConsumer,
  stopNotificationConsumer: hoisted.stopNotificationConsumer,
}));
vi.mock(
  "@/modules/notifications/services/notifications.push.service.js",
  () => ({
    registerNotificationsPush: hoisted.registerNotificationsPush,
  }),
);
vi.mock("@/modules/messaging/messaging.socket.js", () => ({
  initializeMessagingSocket: hoisted.initializeMessagingSocket,
}));
vi.mock("@/modules/payouts/payouts.cron.js", () => ({
  startPayoutCron: hoisted.startPayoutCron,
}));
vi.mock("@/modules/contracts/index.js", () => ({
  startRefundReconciliationCron: hoisted.startRefundReconciliationCron,
  startOrphanPaymentDetectionCron: () => undefined,
}));
vi.mock("@/bootstrap/crash-handlers.js", () => ({
  handleFatalError: hoisted.handleFatalError,
}));
vi.mock("@/bootstrap/shutdown.js", () => ({
  exitWithFlush: hoisted.exitWithFlush,
  SHUTDOWN_TIMEOUT_MS: 10_000,
  CONNECTION_GRACE_MS: 3_000,
}));

class FakeServer extends EventEmitter {
  listen = vi.fn((_port: number, onListening: () => void) => {
    hoisted.order.push("listen");
    queueMicrotask(onListening);
    return this;
  });
}

const load = async () => {
  vi.resetModules();
  return import("@/bootstrap/start.js");
};

describe("startup order and failures", () => {
  let server: FakeServer;

  beforeEach(() => {
    hoisted.order.length = 0;
    server = new FakeServer();
    hoisted.createServer.mockReset().mockReturnValue(server);
    hoisted.pingDatabase.mockReset().mockResolvedValue(undefined);
    hoisted.connectRedis.mockReset().mockResolvedValue(undefined);
    hoisted.isRabbitEnabled.mockReset().mockReturnValue(true);
    hoisted.startNotificationConsumer
      .mockReset()
      .mockImplementation(async () => {
        hoisted.order.push("consumer");
      });
    hoisted.startDeadLetterMonitor.mockReset().mockImplementation(() => {
      hoisted.order.push("monitor");
    });
    hoisted.stopDeadLetterMonitor.mockReset().mockResolvedValue(undefined);
    hoisted.stopNotificationConsumer.mockReset().mockResolvedValue(undefined);
    hoisted.initializeMessagingSocket.mockReset().mockImplementation(() => {
      hoisted.order.push("socket");
    });
    hoisted.startPayoutCron.mockReset().mockImplementation(() => {
      hoisted.order.push("cron");
    });
    hoisted.startRefundReconciliationCron.mockReset().mockImplementation(() => {
      hoisted.order.push("refund-cron");
    });
    hoisted.registerNotificationsPush.mockReset().mockImplementation(() => {
      hoisted.order.push("push");
    });
    hoisted.handleFatalError.mockReset().mockResolvedValue(undefined);
    hoisted.exitWithFlush.mockReset().mockResolvedValue(undefined);
  });

  it("checks the database first, then starts consumer, socket and cron only after listening", async () => {
    const { start } = await load();
    await start();

    expect(hoisted.pingDatabase).toHaveBeenCalledTimes(1);
    expect(hoisted.order).toEqual([
      "listen",
      "push",
      "consumer",
      "monitor",
      "socket",
      "cron",
      "refund-cron",
    ]);
    expect(hoisted.pingDatabase.mock.invocationCallOrder[0]!).toBeLessThan(
      hoisted.connectRedis.mock.invocationCallOrder[0]!,
    );
  });

  it("registers the notification pusher at startup when RabbitMQ is enabled", async () => {
    hoisted.isRabbitEnabled.mockReturnValue(true);
    const { start } = await load();
    await start();

    expect(hoisted.registerNotificationsPush).toHaveBeenCalledTimes(1);
    expect(hoisted.startNotificationConsumer).toHaveBeenCalledTimes(1);
  });

  it("registers the notification pusher at startup when RabbitMQ is disabled, without the consumer", async () => {
    hoisted.isRabbitEnabled.mockReturnValue(false);
    const { start } = await load();
    await start();

    expect(hoisted.registerNotificationsPush).toHaveBeenCalledTimes(1);
    expect(hoisted.startNotificationConsumer).not.toHaveBeenCalled();
    expect(hoisted.startDeadLetterMonitor).not.toHaveBeenCalled();
  });

  it("registers no pusher when the database check fails", async () => {
    hoisted.pingDatabase.mockRejectedValue(new Error("connection refused"));
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.registerNotificationsPush).not.toHaveBeenCalled();
  });

  it("fails before listening and starts nothing when the database check fails", async () => {
    hoisted.pingDatabase.mockRejectedValue(new Error("connection refused"));
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.connectRedis).not.toHaveBeenCalled();
    expect(hoisted.createServer).not.toHaveBeenCalled();
    expect(server.listen).not.toHaveBeenCalled();
    expect(hoisted.startNotificationConsumer).not.toHaveBeenCalled();
    expect(hoisted.initializeMessagingSocket).not.toHaveBeenCalled();
    expect(hoisted.startPayoutCron).not.toHaveBeenCalled();
    expect(hoisted.startRefundReconciliationCron).not.toHaveBeenCalled();
    expect(hoisted.stopDeadLetterMonitor).toHaveBeenCalledTimes(1);
    expect(hoisted.exitWithFlush).toHaveBeenCalledTimes(1);
    expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
  });

  it("still closes rabbit and exits when stopping the monitor rejects", async () => {
    hoisted.pingDatabase.mockRejectedValue(new Error("connection refused"));
    hoisted.stopDeadLetterMonitor.mockRejectedValue(new Error("stuck"));
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
  });

  it("stops a running consumer before the monitor when startup fails after it started", async () => {
    hoisted.initializeMessagingSocket.mockImplementation(() => {
      throw new Error("socket failed");
    });
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.stopNotificationConsumer).toHaveBeenCalledTimes(1);
    expect(hoisted.stopNotificationConsumer).toHaveBeenCalledWith(3_000);
    expect(
      hoisted.stopNotificationConsumer.mock.invocationCallOrder[0],
    ).toBeLessThan(
      hoisted.stopDeadLetterMonitor.mock.invocationCallOrder[0] ?? 0,
    );
    expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
  });

  it("still stops the monitor and exits when stopping the consumer rejects", async () => {
    hoisted.pingDatabase.mockRejectedValue(new Error("connection refused"));
    hoisted.stopNotificationConsumer.mockRejectedValue(new Error("stuck"));
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.stopDeadLetterMonitor).toHaveBeenCalledTimes(1);
    expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
  });

  it("still exits when stopping the consumer never settles", async () => {
    vi.useFakeTimers();
    try {
      hoisted.pingDatabase.mockRejectedValue(new Error("connection refused"));
      hoisted.stopNotificationConsumer.mockReturnValue(new Promise(() => {}));
      const { start, handleStartupFailure } = await load();

      const failure = start().catch(handleStartupFailure);
      await vi.advanceTimersByTimeAsync(6_000);
      await failure;

      expect(hoisted.stopDeadLetterMonitor).toHaveBeenCalledTimes(1);
      expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits non-zero and starts nothing when listen fails", async () => {
    server.listen.mockImplementation(() => {
      hoisted.order.push("listen");
      queueMicrotask(() =>
        server.emit(
          "error",
          Object.assign(new Error("address in use"), { code: "EADDRINUSE" }),
        ),
      );
      return server;
    });
    const { start, handleStartupFailure } = await load();

    await start().catch(handleStartupFailure);

    expect(hoisted.order).toEqual(["listen"]);
    expect(hoisted.startNotificationConsumer).not.toHaveBeenCalled();
    expect(hoisted.initializeMessagingSocket).not.toHaveBeenCalled();
    expect(hoisted.startPayoutCron).not.toHaveBeenCalled();
    expect(hoisted.exitWithFlush).toHaveBeenCalledWith(1);
    expect(hoisted.handleFatalError).not.toHaveBeenCalled();
  });

  it("routes a server error after listening to the fatal handler", async () => {
    const { start } = await load();
    await start();

    const failure = new Error("socket error");
    server.emit("error", failure);

    expect(hoisted.handleFatalError).toHaveBeenCalledWith(
      "serverError",
      failure,
    );
  });
});
