import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  waitForPayoutRun: vi.fn(),
  poolEnd: vi.fn(),
  info: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: {
    info: hoisted.info,
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    fatal: hoisted.fatal,
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
vi.mock("@/modules/outbox/index.js", () => ({
  startOutboxRelay: vi.fn(),
  stopOutboxRelay: vi.fn(),
  waitForOutboxRelayRun: vi.fn().mockResolvedValue(undefined),
  getOutboxStats: vi.fn(),
}));
vi.mock("@/modules/notifications/notifications.consumer.js", () => ({
  stopNotificationConsumer: vi.fn(),
}));
vi.mock("@/modules/messaging/messaging.socket.js", () => ({
  closeMessagingSocket: vi.fn(),
}));
vi.mock("@/modules/notification-store/index.js", () => ({
  registerNotificationPusher: vi.fn(),
}));
vi.mock("@/modules/payouts/payouts.cron.js", () => ({
  stopPayoutCron: vi.fn(),
  waitForPayoutRun: hoisted.waitForPayoutRun,
}));

const flush = async () => {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
};

type Handler = (value: unknown) => void;

describe("crash handlers", () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let on: ReturnType<typeof vi.spyOn>;
  const registered = new Map<string, Handler>();
  let registrations: string[] = [];

  const handlerFor = (event: string): Handler => registered.get(event)!;

  beforeEach(() => {
    vi.resetModules();
    hoisted.waitForPayoutRun.mockReset().mockResolvedValue(undefined);
    hoisted.poolEnd.mockReset().mockResolvedValue(undefined);
    hoisted.info.mockReset().mockResolvedValue(undefined);
    hoisted.fatal.mockReset().mockResolvedValue(undefined);
    exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    registered.clear();
    registrations = [];
    on = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: Handler,
    ) => {
      registrations.push(event);
      registered.set(event, handler);
      return process;
    }) as never);
  });

  afterEach(() => {
    exit.mockRestore();
    on.mockRestore();
  });

  it("registers each handler once even when called repeatedly", async () => {
    const { registerCrashHandlers } =
      await import("@/bootstrap/crash-handlers.js");
    registerCrashHandlers();
    registerCrashHandlers();

    expect([...registrations].sort()).toEqual([
      "uncaughtException",
      "unhandledRejection",
    ]);
  });

  it("does not register anything on import", async () => {
    await import("@/bootstrap/crash-handlers.js");
    expect(registrations).toEqual([]);
  });

  it("logs an unhandled rejection, shuts down once and exits non-zero", async () => {
    const { registerCrashHandlers } =
      await import("@/bootstrap/crash-handlers.js");
    registerCrashHandlers();

    handlerFor("unhandledRejection")(new Error("rejected"));
    await flush();

    expect(hoisted.fatal).toHaveBeenCalledTimes(1);
    expect(hoisted.fatal.mock.calls[0]![0]).toMatchObject({
      eventName: "system.crash",
      attributes: {
        "crash.source": "unhandledRejection",
        "error.name": "Error",
      },
    });
    expect(hoisted.info).toHaveBeenCalledTimes(1);
    expect(hoisted.info.mock.calls[0]![0]).toMatchObject({
      attributes: { "process.signal": "unhandledRejection" },
    });
    expect(hoisted.poolEnd).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts a single shutdown when a second crash arrives mid-shutdown", async () => {
    let finishRun!: () => void;
    hoisted.waitForPayoutRun.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRun = resolve;
      }),
    );
    const { registerCrashHandlers } =
      await import("@/bootstrap/crash-handlers.js");
    registerCrashHandlers();

    handlerFor("uncaughtException")(new Error("first"));
    await flush();
    handlerFor("unhandledRejection")("second");
    await flush();

    expect(hoisted.fatal).toHaveBeenCalledTimes(2);
    expect(hoisted.info).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finishRun();
    await flush();
    expect(hoisted.poolEnd).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still shuts down and does not loop when the logger itself fails", async () => {
    hoisted.fatal.mockRejectedValue(new Error("logger down"));
    const { registerCrashHandlers } =
      await import("@/bootstrap/crash-handlers.js");
    registerCrashHandlers();

    handlerFor("uncaughtException")(new Error("crash"));
    await flush();

    expect(hoisted.fatal).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
