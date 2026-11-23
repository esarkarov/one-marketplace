import { EventEmitter } from "node:events";
import type { Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  rabbitOrder: [] as string[],
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
  closeRabbit: async () => {
    hoisted.rabbitOrder.push("close-rabbit");
  },
}));
vi.mock("@/infrastructure/events/notification.monitor.js", () => ({
  stopDeadLetterMonitor: () => {
    hoisted.rabbitOrder.push("stop-monitor");
  },
}));
vi.mock("@/modules/notifications/notifications.consumer.js", () => ({
  stopNotificationConsumer: async () => {
    hoisted.rabbitOrder.push("stop-consumer");
  },
}));
vi.mock("@/modules/messaging/messaging.socket.js", () => ({
  closeMessagingSocket: vi.fn(),
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
    hoisted.rabbitOrder.length = 0;
    hoisted.warn.mockReset().mockResolvedValue(undefined);
    hoisted.waitForRefundRun.mockReset().mockResolvedValue(undefined);
    hoisted.waitForPayoutRun.mockReset().mockResolvedValue(undefined);
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
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    const done = shutdown("SIGINT");
    await flush();
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    finish();
    await done;

    expect(hoisted.order).toEqual([
      "stop-cron",
      "stop-refund-cron",
      "run-finished",
      "pool-end",
    ]);
    expect(hoisted.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("stops the consumer, then the dead-letter monitor, then closes RabbitMQ", async () => {
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    await shutdown("SIGTERM");

    expect(hoisted.rabbitOrder).toEqual([
      "stop-consumer",
      "stop-monitor",
      "close-rabbit",
    ]);
  });

  it("warns and continues when the run outlasts the drain timeout", async () => {
    vi.useFakeTimers();
    hoisted.waitForPayoutRun.mockReturnValue(
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
    expect(hoisted.order).toEqual([
      "stop-cron",
      "stop-refund-cron",
      "pool-end",
    ]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("stops the refund reconciliation cron, then awaits its in-flight run before closing the pool", async () => {
    let finish!: () => void;
    hoisted.waitForRefundRun.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = () => {
          hoisted.order.push("refund-run-finished");
          resolve();
        };
      }),
    );
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    const done = shutdown("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(hoisted.order).toEqual(["stop-cron", "stop-refund-cron"]);
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    finish();
    await done;

    expect(hoisted.order).toEqual([
      "stop-cron",
      "stop-refund-cron",
      "refund-run-finished",
      "pool-end",
    ]);
    expect(hoisted.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("returns at once when no refund reconciliation run is in flight", async () => {
    const { shutdown } = await import("@/bootstrap/shutdown.js");

    await shutdown("SIGINT");

    expect(hoisted.order).toEqual([
      "stop-cron",
      "stop-refund-cron",
      "pool-end",
    ]);
    expect(hoisted.warn).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("warns and continues when the refund reconciliation run outlasts the drain timeout", async () => {
    vi.useFakeTimers();
    hoisted.waitForRefundRun.mockReturnValue(
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
      eventName: "system.shutdown.refund_reconciliation_run_timeout",
    });
    expect(hoisted.order).toEqual([
      "stop-cron",
      "stop-refund-cron",
      "pool-end",
    ]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("keeps the drain bound below the forced-exit timeout", async () => {
    const { PAYOUT_DRAIN_TIMEOUT_MS, SHUTDOWN_TIMEOUT_MS } =
      await import("@/bootstrap/shutdown.js");
    expect(PAYOUT_DRAIN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PAYOUT_DRAIN_TIMEOUT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  });
});

describe("shutdown SSE streams", () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    hoisted.order.length = 0;
    hoisted.rabbitOrder.length = 0;
    hoisted.warn.mockReset().mockResolvedValue(undefined);
    hoisted.waitForRefundRun.mockReset().mockResolvedValue(undefined);
    hoisted.waitForPayoutRun.mockReset().mockResolvedValue(undefined);
    hoisted.poolEnd.mockReset().mockResolvedValue(undefined);
    hoisted.waitForPayoutRun.mockReset().mockImplementation(async () => {
      hoisted.order.push("drain-start");
    });
    hoisted.server.current = {
      close: vi.fn((done: (error?: Error) => void) => {
        hoisted.order.push("server-close");
        done();
      }),
      closeIdleConnections: vi.fn(() => {
        hoisted.order.push("close-idle");
      }),
      closeAllConnections: vi.fn(() => {
        hoisted.order.push("close-all");
      }),
    };
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    hoisted.server.current = undefined;
    vi.useRealTimers();
    exit.mockRestore();
  });

  const fakeStream = () => {
    const stream = Object.assign(new EventEmitter(), {
      write: vi.fn(() => {
        hoisted.order.push("sse-write");
      }),
      end: vi.fn(() => {
        hoisted.order.push("sse-end");
      }),
    });
    return stream;
  };

  it("stops listening, ends streams, then drains payouts", async () => {
    const sse = await import("@/middleware/utils/sse-streams.utils.js");
    const { shutdown } = await import("@/bootstrap/shutdown.js");
    const stream = fakeStream();
    sse.registerSseStream(stream as unknown as Response);

    await shutdown("SIGTERM");

    expect(stream.write).toHaveBeenCalledWith(
      "retry: 1000\nevent: shutdown\ndata: {}\n\n",
    );
    expect(hoisted.order.slice(0, 5)).toEqual([
      "server-close",
      "sse-write",
      "sse-end",
      "close-idle",
      "stop-cron",
    ]);
    expect(hoisted.order.indexOf("sse-end")).toBeLessThan(
      hoisted.order.indexOf("drain-start"),
    );
    expect(hoisted.order).not.toContain("close-all");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("closes streams before the grace timer can start", async () => {
    vi.useFakeTimers();
    hoisted.waitForPayoutRun.mockReturnValue(
      new Promise<void>(() => undefined),
    );
    const sse = await import("@/middleware/utils/sse-streams.utils.js");
    const { shutdown, PAYOUT_DRAIN_TIMEOUT_MS } =
      await import("@/bootstrap/shutdown.js");
    const stream = fakeStream();
    sse.registerSseStream(stream as unknown as Response);

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(stream.end).toHaveBeenCalledTimes(1);
    expect(hoisted.server.current?.closeAllConnections).not.toHaveBeenCalled();
    expect(hoisted.poolEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PAYOUT_DRAIN_TIMEOUT_MS);
    await done;
  });

  it("does not write twice when shutdown runs twice", async () => {
    const sse = await import("@/middleware/utils/sse-streams.utils.js");
    const { shutdown } = await import("@/bootstrap/shutdown.js");
    const stream = fakeStream();
    sse.registerSseStream(stream as unknown as Response);

    await Promise.all([shutdown("SIGTERM"), shutdown("uncaughtException")]);

    expect(stream.write).toHaveBeenCalledTimes(1);
    expect(stream.end).toHaveBeenCalledTimes(1);
    expect(hoisted.server.current?.close).toHaveBeenCalledTimes(1);
  });

  it("answers new SSE requests with 503 and Retry-After once shutdown started", async () => {
    const sse = await import("@/middleware/utils/sse-streams.utils.js");
    const { shutdown } = await import("@/bootstrap/shutdown.js");
    await shutdown("SIGTERM");

    const headers: Record<string, string> = {};
    const response = {
      set: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;

    expect(() => sse.assertSseAvailable(response)).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    );
    expect(headers["Retry-After"]).toBe("1");
  });
});
