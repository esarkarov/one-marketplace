import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  scheduled: [] as Array<{
    expression: string;
    task: () => Promise<void>;
    options: unknown;
  }>,
  destroy: vi.fn(),
  detect: vi.fn(),
  reconcile: vi.fn(),
  mode: { current: "detect" as "off" | "detect" },
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
    refundReconciliationMode: "detect",
    get orphanPaymentDetectionMode() {
      return hoisted.mode.current;
    },
  },
}));
vi.mock(
  "@/modules/contracts/services/contracts.refund-reconciliation.service.js",
  () => ({ reconcileCancelledContractRefunds: hoisted.reconcile }),
);
vi.mock(
  "@/modules/contracts/services/contracts.orphan-payment-detection.service.js",
  () => ({ detectOrphanPaidSessions: hoisted.detect }),
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

describe("orphan payment detection cron", () => {
  beforeEach(() => {
    hoisted.scheduled.length = 0;
    hoisted.destroy.mockReset();
    hoisted.detect.mockReset().mockResolvedValue({});
    hoisted.reconcile.mockReset().mockResolvedValue({});
    hoisted.mode.current = "detect";
    hoisted.loggerInfo.mockReset().mockResolvedValue(undefined);
    hoisted.loggerDebug.mockReset().mockResolvedValue(undefined);
    hoisted.loggerError.mockReset().mockResolvedValue(undefined);
  });

  describe("scheduling", () => {
    it("schedules at minute 17 of every hour in detect without running at boot", async () => {
      const { startOrphanPaymentDetectionCron } = await load();

      startOrphanPaymentDetectionCron();

      expect(hoisted.scheduled).toHaveLength(1);
      expect(hoisted.scheduled[0]!.expression).toBe("17 * * * *");
      expect(hoisted.detect).not.toHaveBeenCalled();
      expect(eventNames(hoisted.loggerInfo)).toEqual([
        "payment.orphan.scheduled",
      ]);
    });

    it("registers nothing and logs the disabled line in mode off", async () => {
      hoisted.mode.current = "off";
      const {
        startOrphanPaymentDetectionCron,
        stopOrphanPaymentDetectionCron,
      } = await load();

      startOrphanPaymentDetectionCron();
      await stopOrphanPaymentDetectionCron();

      expect(hoisted.scheduled).toHaveLength(0);
      expect(hoisted.destroy).not.toHaveBeenCalled();
      expect(hoisted.detect).not.toHaveBeenCalled();
      expect(eventNames(hoisted.loggerInfo)).toEqual([
        "payment.orphan.disabled",
      ]);
    });

    it("does not schedule twice when started twice", async () => {
      const { startOrphanPaymentDetectionCron } = await load();

      startOrphanPaymentDetectionCron();
      startOrphanPaymentDetectionCron();

      expect(hoisted.scheduled).toHaveLength(1);
    });
  });

  describe("tick handler", () => {
    it("runs the detection once per tick", async () => {
      const { startOrphanPaymentDetectionCron } = await load();
      startOrphanPaymentDetectionCron();

      await hoisted.scheduled[0]!.task();

      expect(hoisted.detect).toHaveBeenCalledTimes(1);
      expect(hoisted.reconcile).not.toHaveBeenCalled();
    });

    it("skips a tick while the previous run is pending and runs again after it", async () => {
      const first = deferred();
      hoisted.detect.mockReturnValueOnce(first.promise);
      const { startOrphanPaymentDetectionCron } = await load();
      startOrphanPaymentDetectionCron();
      const tick = hoisted.scheduled[0]!.task;

      const firstTick = tick();
      await flush();
      await tick();

      expect(hoisted.detect).toHaveBeenCalledTimes(1);
      expect(eventNames(hoisted.loggerDebug)).toEqual([
        "payment.orphan.skipped_overlap",
      ]);

      first.resolve();
      await firstTick;
      await tick();

      expect(hoisted.detect).toHaveBeenCalledTimes(2);
    });

    it("catches a throwing service, logs the code only and runs the next tick", async () => {
      const failure = Object.assign(new Error("secret detail pi_123"), {
        code: "ECONNRESET",
      });
      hoisted.detect.mockRejectedValueOnce(failure);
      const {
        startOrphanPaymentDetectionCron,
        waitForOrphanPaymentDetectionRun,
      } = await load();
      startOrphanPaymentDetectionCron();
      const tick = hoisted.scheduled[0]!.task;

      await expect(tick()).resolves.toBeUndefined();

      expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
      const entry = hoisted.loggerError.mock.calls[0]![0] as {
        eventName: string;
        attributes: Record<string, unknown>;
      };
      expect(entry.eventName).toBe("payment.orphan.failed");
      expect(entry.attributes).toEqual({ "error.code": "ECONNRESET" });
      expect(JSON.stringify(entry)).not.toContain("secret detail");
      await expect(waitForOrphanPaymentDetectionRun()).resolves.toBeUndefined();

      await tick();
      expect(hoisted.detect).toHaveBeenCalledTimes(2);
    });

    it("logs the error name when there is no code", async () => {
      hoisted.detect.mockRejectedValueOnce(new TypeError("boom"));
      const { startOrphanPaymentDetectionCron } = await load();
      startOrphanPaymentDetectionCron();

      await hoisted.scheduled[0]!.task();

      const entry = hoisted.loggerError.mock.calls[0]![0] as {
        attributes: Record<string, unknown>;
      };
      expect(entry.attributes["error.code"]).toBe("TypeError");
    });

    it("survives a failing logger and still releases the guard", async () => {
      hoisted.detect.mockRejectedValueOnce(new Error("boom"));
      hoisted.loggerError.mockRejectedValueOnce(new Error("log down"));
      const { startOrphanPaymentDetectionCron } = await load();
      startOrphanPaymentDetectionCron();
      const tick = hoisted.scheduled[0]!.task;

      await expect(tick()).resolves.toBeUndefined();
      await tick();

      expect(hoisted.detect).toHaveBeenCalledTimes(2);
    });

    it("keeps its overlap guard independent of the refund reconciliation run", async () => {
      const refundRun = deferred();
      hoisted.reconcile.mockReturnValueOnce(refundRun.promise);
      const { startOrphanPaymentDetectionCron, startRefundReconciliationCron } =
        await load();
      startRefundReconciliationCron();
      startOrphanPaymentDetectionCron();
      const refundTick = hoisted.scheduled[0]!.task();
      await flush();

      await hoisted.scheduled[1]!.task();

      expect(hoisted.detect).toHaveBeenCalledTimes(1);
      refundRun.resolve();
      await refundTick;
    });
  });

  describe("shutdown", () => {
    it("returns immediately when no run is in flight", async () => {
      const {
        startOrphanPaymentDetectionCron,
        waitForOrphanPaymentDetectionRun,
      } = await load();
      startOrphanPaymentDetectionCron();

      await expect(waitForOrphanPaymentDetectionRun()).resolves.toBeUndefined();
    });

    it("stops scheduling and awaits an in-flight run", async () => {
      const run = deferred();
      hoisted.detect.mockReturnValueOnce(run.promise);
      const {
        startOrphanPaymentDetectionCron,
        stopOrphanPaymentDetectionCron,
        waitForOrphanPaymentDetectionRun,
      } = await load();
      startOrphanPaymentDetectionCron();
      const execution = hoisted.scheduled[0]!.task();

      await stopOrphanPaymentDetectionCron();
      expect(hoisted.destroy).toHaveBeenCalledTimes(1);

      let waited = false;
      const waiting = waitForOrphanPaymentDetectionRun().then(() => {
        waited = true;
      });
      await flush();
      expect(waited).toBe(false);

      run.resolve();
      await execution;
      await waiting;
      expect(waited).toBe(true);
    });

    it("stop without start is a no-op", async () => {
      const { stopOrphanPaymentDetectionCron } = await load();

      await expect(stopOrphanPaymentDetectionCron()).resolves.toBeUndefined();
      expect(hoisted.destroy).not.toHaveBeenCalled();
    });

    it("does not throw when destroy fails", async () => {
      hoisted.destroy.mockRejectedValueOnce(new Error("destroy failed"));
      const {
        startOrphanPaymentDetectionCron,
        stopOrphanPaymentDetectionCron,
      } = await load();
      startOrphanPaymentDetectionCron();

      await expect(stopOrphanPaymentDetectionCron()).resolves.toBeUndefined();
    });
  });
});
