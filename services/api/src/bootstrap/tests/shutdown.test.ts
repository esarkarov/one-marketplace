import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  waitForPayoutRun: vi.fn(),
  poolEnd: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: hoisted.warn,
    error: vi.fn().mockResolvedValue(undefined),
    fatal: vi.fn().mockResolvedValue(undefined),
  },
  rootLogger: { flush: (done: () => void) => done() },
}));
vi.mock("../../database/client.js", () => ({
  pool: { end: hoisted.poolEnd },
}));
vi.mock("../../infrastructure/cache/redis.client.js", () => ({
  disconnectRedis: vi.fn(),
}));
vi.mock("../../infrastructure/events/rabbitmq.client.js", () => ({
  closeRabbit: vi.fn(),
}));
vi.mock("../../modules/notifications/notifications.consumer.js", () => ({
  stopNotificationConsumer: vi.fn(),
}));
vi.mock("../../modules/messaging/messaging.socket.js", () => ({
  closeMessagingSocket: vi.fn(),
}));
vi.mock("../../modules/payouts/payouts.cron.js", () => ({
  stopPayoutCron: async () => {
    hoisted.order.push("stop-cron");
  },
  waitForPayoutRun: hoisted.waitForPayoutRun,
}));

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe("shutdown payout drain", () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    hoisted.order.length = 0;
    hoisted.warn.mockReset().mockResolvedValue(undefined);
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

  it("awaits an in-flight payout run before closing the pool", async () => {
    let finish!: () => void;
    hoisted.waitForPayoutRun.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = () => {
          hoisted.order.push("run-finished");
          resolve();
        };
      }),
    );
    const { shutdown } = await import("../shutdown.js");

    const done = shutdown("SIGINT");
    await flush();
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    finish();
    await done;

    expect(hoisted.order).toEqual(["stop-cron", "run-finished", "pool-end"]);
    expect(hoisted.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("warns and continues when the run outlasts the drain timeout", async () => {
    vi.useFakeTimers();
    hoisted.waitForPayoutRun.mockReturnValue(
      new Promise<void>(() => undefined),
    );
    const { shutdown, PAYOUT_DRAIN_TIMEOUT_MS } =
      await import("../shutdown.js");

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(PAYOUT_DRAIN_TIMEOUT_MS - 1);
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(hoisted.warn).toHaveBeenCalledTimes(1);
    expect(hoisted.order).toEqual(["stop-cron", "pool-end"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("keeps the drain bound below the forced-exit timeout", async () => {
    const { PAYOUT_DRAIN_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS } =
      await import("../shutdown.js");
    expect(PAYOUT_DRAIN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PAYOUT_DRAIN_TIMEOUT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  });
});
