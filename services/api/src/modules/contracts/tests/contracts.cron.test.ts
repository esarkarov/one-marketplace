import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  scheduled: [] as Array<{
    expression: string;
    task: () => Promise<void>;
    options: unknown;
  }>,
  destroy: vi.fn(),
  reconcile: vi.fn(),
  mode: { current: "detect" as "off" | "detect" | "on" },
  loggerInfo: vi.fn(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: (
      expression: string,
      task: () => Promise<void>,
      options: unknown,
    ) => {
      hoisted.scheduled.push({ expression, task, options });
      return { destroy: hoisted.destroy };
    },
  },
}));
vi.mock("@/config/env.js", () => ({
  env: {
    get refundReconciliationMode() {
      return hoisted.mode.current;
    },
  },
}));
vi.mock(
  "@/modules/contracts/services/contracts.refund-reconciliation.service.js",
  () => ({ reconcileCancelledContractRefunds: hoisted.reconcile }),
);
vi.mock("@/config/logger.js", () => ({
  logger: {
    info: hoisted.loggerInfo,
    debug: hoisted.loggerDebug,
    error: hoisted.loggerError,
  },
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

const load = async () => {
  vi.resetModules();
  return import("@/modules/contracts/contracts.cron.js");
};

const eventNames = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map((call) => (call[0] as { eventName: string }).eventName);

describe("refund reconciliation cron", () => {
  beforeEach(() => {
    hoisted.scheduled.length = 0;
    hoisted.destroy.mockReset();
    hoisted.reconcile.mockReset().mockResolvedValue({});
    hoisted.mode.current = "detect";
    hoisted.loggerInfo.mockReset().mockResolvedValue(undefined);
    hoisted.loggerDebug.mockReset().mockResolvedValue(undefined);
    hoisted.loggerError.mockReset().mockResolvedValue(undefined);
  });

  describe("scheduling by mode", () => {
    it.each(["detect", "on"] as const)(
      "schedules every 15 minutes in mode %s without running at boot",
      async (mode) => {
        hoisted.mode.current = mode;
        const { startRefundReconciliationCron } = await load();

        startRefundReconciliationCron();

        expect(hoisted.scheduled).toHaveLength(1);
        expect(hoisted.scheduled[0]!.expression).toBe("*/15 * * * *");
        expect(hoisted.reconcile).not.toHaveBeenCalled();
        expect(eventNames(hoisted.loggerInfo)).toEqual([
          "refund.reconcile.scheduled",
        ]);
      },
    );

    it("registers nothing and logs the disabled line in mode off", async () => {
      hoisted.mode.current = "off";
      const { startRefundReconciliationCron, stopRefundReconciliationCron } =
        await load();

      startRefundReconciliationCron();
      await stopRefundReconciliationCron();

      expect(hoisted.scheduled).toHaveLength(0);
      expect(hoisted.destroy).not.toHaveBeenCalled();
      expect(hoisted.reconcile).not.toHaveBeenCalled();
      expect(eventNames(hoisted.loggerInfo)).toEqual([
        "refund.reconcile.disabled",
      ]);
    });

    it("does not schedule twice when started twice", async () => {
      const { startRefundReconciliationCron } = await load();

      startRefundReconciliationCron();
      startRefundReconciliationCron();

      expect(hoisted.scheduled).toHaveLength(1);
    });
  });

  describe("tick handler", () => {
    it.each(["detect", "on"] as const)(
      "passes mode %s to the service",
      async (mode) => {
        hoisted.mode.current = mode;
        const { startRefundReconciliationCron } = await load();
        startRefundReconciliationCron();

        await hoisted.scheduled[0]!.task();

        expect(hoisted.reconcile).toHaveBeenCalledTimes(1);
        expect(hoisted.reconcile).toHaveBeenCalledWith({ mode });
      },
    );

    it("skips a tick while the previous run is pending and runs again after it", async () => {
      const first = deferred();
      hoisted.reconcile.mockReturnValueOnce(first.promise);
      const { startRefundReconciliationCron } = await load();
      startRefundReconciliationCron();
      const tick = hoisted.scheduled[0]!.task;

      const firstTick = tick();
      await flush();
      await tick();

      expect(hoisted.reconcile).toHaveBeenCalledTimes(1);
      expect(eventNames(hoisted.loggerDebug)).toEqual([
        "refund.reconcile.skipped_overlap",
      ]);

      first.resolve();
      await firstTick;
      await tick();

      expect(hoisted.reconcile).toHaveBeenCalledTimes(2);
    });

    it("catches a throwing service, logs the code only and runs the next tick", async () => {
      const failure = Object.assign(new Error("secret detail pi_123"), {
        code: "ECONNRESET",
      });
      hoisted.reconcile.mockRejectedValueOnce(failure);
      const { startRefundReconciliationCron, waitForRefundReconciliationRun } =
        await load();
      startRefundReconciliationCron();
      const tick = hoisted.scheduled[0]!.task;

      await expect(tick()).resolves.toBeUndefined();

      expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
      const entry = hoisted.loggerError.mock.calls[0]![0] as {
        eventName: string;
        attributes: Record<string, unknown>;
      };
      expect(entry.eventName).toBe("refund.reconcile.failed");
      expect(entry.attributes["error.code"]).toBe("ECONNRESET");
      expect(JSON.stringify(entry)).not.toContain("secret detail");
      await expect(waitForRefundReconciliationRun()).resolves.toBeUndefined();

      await tick();
      expect(hoisted.reconcile).toHaveBeenCalledTimes(2);
    });

    it("logs the error name when there is no code", async () => {
      hoisted.reconcile.mockRejectedValueOnce(new TypeError("boom"));
      const { startRefundReconciliationCron } = await load();
      startRefundReconciliationCron();

      await hoisted.scheduled[0]!.task();

      const entry = hoisted.loggerError.mock.calls[0]![0] as {
        attributes: Record<string, unknown>;
      };
      expect(entry.attributes["error.code"]).toBe("TypeError");
    });

    it("survives a failing logger and still releases the guard", async () => {
      hoisted.reconcile.mockRejectedValueOnce(new Error("boom"));
      hoisted.loggerError.mockRejectedValueOnce(new Error("log down"));
      const { startRefundReconciliationCron } = await load();
      startRefundReconciliationCron();
      const tick = hoisted.scheduled[0]!.task;

      await expect(tick()).resolves.toBeUndefined();
      await tick();

      expect(hoisted.reconcile).toHaveBeenCalledTimes(2);
    });
  });

  describe("shutdown", () => {
    it("returns immediately when no run is in flight", async () => {
      const { startRefundReconciliationCron, waitForRefundReconciliationRun } =
        await load();
      startRefundReconciliationCron();

      await expect(waitForRefundReconciliationRun()).resolves.toBeUndefined();
    });

    it("stops scheduling and awaits an in-flight run", async () => {
      const run = deferred();
      hoisted.reconcile.mockReturnValueOnce(run.promise);
      const {
        startRefundReconciliationCron,
        stopRefundReconciliationCron,
        waitForRefundReconciliationRun,
      } = await load();
      startRefundReconciliationCron();
      const execution = hoisted.scheduled[0]!.task();

      await stopRefundReconciliationCron();
      expect(hoisted.destroy).toHaveBeenCalledTimes(1);

      let waited = false;
      const waiting = waitForRefundReconciliationRun().then(() => {
        waited = true;
      });
      await flush();
      expect(waited).toBe(false);

      run.resolve();
      await execution;
      await waiting;
      expect(waited).toBe(true);
      await expect(waitForRefundReconciliationRun()).resolves.toBeUndefined();
    });

    it("stop without start is a no-op", async () => {
      const { stopRefundReconciliationCron } = await load();

      await expect(stopRefundReconciliationCron()).resolves.toBeUndefined();
      expect(hoisted.destroy).not.toHaveBeenCalled();
    });
  });
});
