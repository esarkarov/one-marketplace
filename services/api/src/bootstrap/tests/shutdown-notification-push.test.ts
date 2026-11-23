import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  waitForPayoutRun: vi.fn(),
  waitForRefundRun: vi.fn(),
  poolEnd: vi.fn(),
  warn: vi.fn(),
  server: {
    current: undefined as
      | {
          close: ReturnType<typeof vi.fn>;
          closeIdleConnections: ReturnType<typeof vi.fn>;
          closeAllConnections: ReturnType<typeof vi.fn>;
        }
      | undefined,
  },
}));

vi.mock("@/bootstrap/http-server.js", () => ({
  getHttpServer: () => hoisted.server.current,
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: hoisted.warn,
    error: vi.fn().mockResolvedValue(undefined),
    fatal: vi.fn().mockResolvedValue(undefined),
  },
  rootLogger: { flush: (done: () => void) => done() },
}));
vi.mock("@/database/client.js", () => ({
  pool: { end: hoisted.poolEnd },
}));
vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  disconnectRedis: vi.fn(),
}));
vi.mock("@/infrastructure/events/rabbitmq.client.js", () => ({
  closeRabbit: vi.fn(),
}));
vi.mock("@/infrastructure/events/notification.monitor.js", () => ({
  stopDeadLetterMonitor: vi.fn(),
}));
vi.mock("@/modules/notifications/notifications.consumer.js", () => ({
  stopNotificationConsumer: vi.fn(),
}));
vi.mock("@/modules/messaging/messaging.socket.js", () => ({
  closeMessagingSocket: vi.fn(),
}));
vi.mock("@/modules/notification-store/index.js", () => ({
  registerNotificationPusher: (pusher: unknown) => {
    if (pusher === null) hoisted.order.push("clear-push");
  },
}));
vi.mock("@/modules/payouts/payouts.cron.js", () => ({
  stopPayoutCron: async () => {
    hoisted.order.push("stop-cron");
  },
  waitForPayoutRun: hoisted.waitForPayoutRun,
}));

vi.mock("@/modules/contracts/index.js", () => ({
  stopRefundReconciliationCron: async () => {
    hoisted.order.push("stop-refund-cron");
  },
  waitForRefundReconciliationRun: hoisted.waitForRefundRun,
  stopOrphanPaymentDetectionCron: async () => undefined,
  waitForOrphanPaymentDetectionRun: async () => undefined,
}));

describe("shutdown notification push", () => {
  it("clears the registered pusher before the consumer and the pool close", async () => {
    vi.resetModules();
    hoisted.order.length = 0;
    hoisted.warn.mockReset().mockResolvedValue(undefined);
    hoisted.waitForRefundRun.mockReset().mockResolvedValue(undefined);
    hoisted.waitForPayoutRun.mockReset().mockResolvedValue(undefined);
    hoisted.poolEnd.mockReset().mockImplementation(async () => {
      hoisted.order.push("pool-end");
    });
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    const { shutdown } = await import("@/bootstrap/shutdown.js");
    await shutdown("SIGTERM");

    expect(hoisted.order).toContain("clear-push");
    expect(hoisted.order.indexOf("clear-push")).toBeLessThan(
      hoisted.order.indexOf("pool-end"),
    );
    exit.mockRestore();
  });
});
