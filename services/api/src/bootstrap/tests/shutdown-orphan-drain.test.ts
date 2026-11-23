import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  waitForPayoutRun: vi.fn(),
  waitForRefundRun: vi.fn(),
  waitForOrphanRun: vi.fn(),
  poolEnd: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/bootstrap/http-server.js", () => ({
  getHttpServer: () => undefined,
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
vi.mock("@/modules/payouts/payouts.cron.js", () => ({
  stopPayoutCron: async () => {
    hoisted.order.push("stop-payout-cron");
  },
  waitForPayoutRun: hoisted.waitForPayoutRun,
}));
vi.mock("@/modules/contracts/index.js", () => ({
  stopRefundReconciliationCron: async () => {
    hoisted.order.push("stop-refund-cron");
  },
  waitForRefundReconciliationRun: hoisted.waitForRefundRun,
  stopOrphanPaymentDetectionCron: async () => {
    hoisted.order.push("stop-orphan-cron");
  },
  waitForOrphanPaymentDetectionRun: hoisted.waitForOrphanRun,
}));

const deferredRun = (label: string) => {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = () => {
      hoisted.order.push(label);
      resolve();
    };
  });
  return { promise, finish };
};

describe("shutdown orphan payment detection drain", () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    hoisted.order.length = 0;
    hoisted.warn.mockReset().mockResolvedValue(undefined);
    hoisted.waitForPayoutRun.mockReset().mockResolvedValue(undefined);
    hoisted.waitForRefundRun.mockReset().mockResolvedValue(undefined);
    hoisted.waitForOrphanRun.mockReset().mockResolvedValue(undefined);
    hoisted.poolEnd.mockReset().mockImplementation(async () => {
      hoisted.order.push("pool-end");
    });
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    exit.mockRestore();
  });

  it("stops the orphan cron and waits for the refund and orphan runs together before closing the pool", async () => {
    const refund = deferredRun("refund-run-finished");
    const orphan = deferredRun("orphan-run-finished");
    hoisted.waitForRefundRun.mockReturnValue(refund.promise);
    hoisted.waitForOrphanRun.mockReturnValue(orphan.promise);
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    const done = shutdown("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(hoisted.order).toContain("stop-orphan-cron");
    expect(hoisted.order).toContain("stop-refund-cron");
    expect(hoisted.waitForOrphanRun).toHaveBeenCalledTimes(1);
    expect(hoisted.waitForRefundRun).toHaveBeenCalledTimes(1);
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    refund.finish();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    orphan.finish();
    await done;

    expect(hoisted.order.slice(-3)).toEqual([
      "refund-run-finished",
      "orphan-run-finished",
      "pool-end",
    ]);
    expect(hoisted.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("warns and continues when the orphan run outlasts the shared drain bound", async () => {
    vi.useFakeTimers();
    hoisted.waitForOrphanRun.mockReturnValue(
      new Promise<void>(() => undefined),
    );
    const { shutdown, PAYOUT_DRAIN_TIMEOUT_MS } =
      await import("@/bootstrap/shutdown.js");

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(PAYOUT_DRAIN_TIMEOUT_MS - 1);
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(hoisted.warn).toHaveBeenCalledTimes(1);
    expect(hoisted.warn.mock.calls[0]![0]).toMatchObject({
      eventName: "system.shutdown.orphan_payment_detection_run_timeout",
    });
    expect(hoisted.order).toContain("pool-end");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("returns at once when no run is in flight", async () => {
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    await shutdown("SIGINT");

    expect(hoisted.order).toContain("stop-orphan-cron");
    expect(hoisted.order.at(-1)).toBe("pool-end");
    expect(hoisted.warn).not.toHaveBeenCalled();
  });
});
