import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  scheduled: [] as Array<() => Promise<void>>,
  destroy: vi.fn(),
  processDuePayouts: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: (_expression: string, task: () => Promise<void>) => {
      hoisted.scheduled.push(task);
      return { destroy: hoisted.destroy };
    },
  },
}));
vi.mock("../services/payouts.service.js", () => ({
  processDuePayouts: hoisted.processDuePayouts,
}));
vi.mock("../../../config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
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
  return import("../payouts.cron.js");
};

describe("payout cron in-flight tracking", () => {
  beforeEach(() => {
    hoisted.scheduled.length = 0;
    hoisted.destroy.mockReset();
    hoisted.processDuePayouts.mockReset();
    hoisted.loggerError.mockReset().mockResolvedValue(undefined);
  });

  it("resolves immediately when no run is in flight", async () => {
    const { startPayoutCron, waitForPayoutRun } = await load();
    startPayoutCron();
    await expect(waitForPayoutRun()).resolves.toBeUndefined();
  });

  it("waits for an in-flight run and clears it afterwards", async () => {
    const run = deferred();
    hoisted.processDuePayouts.mockReturnValueOnce(run.promise);
    const { startPayoutCron, waitForPayoutRun } = await load();
    startPayoutCron();

    const execution = hoisted.scheduled[0]!();
    let waited = false;
    const waiting = waitForPayoutRun().then(() => {
      waited = true;
    });
    await flush();
    expect(waited).toBe(false);

    run.resolve();
    await execution;
    await waiting;
    expect(waited).toBe(true);
    await expect(waitForPayoutRun()).resolves.toBeUndefined();
  });

  it("logs a failed run and still settles the wait", async () => {
    hoisted.processDuePayouts.mockRejectedValueOnce(new Error("boom"));
    const { startPayoutCron, waitForPayoutRun } = await load();
    startPayoutCron();

    await hoisted.scheduled[0]!();
    expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
    await expect(waitForPayoutRun()).resolves.toBeUndefined();
  });

  it("stops scheduling on stop without touching the in-flight run", async () => {
    const run = deferred();
    hoisted.processDuePayouts.mockReturnValueOnce(run.promise);
    const { startPayoutCron, stopPayoutCron, waitForPayoutRun } = await load();
    startPayoutCron();
    const execution = hoisted.scheduled[0]!();

    await stopPayoutCron();
    expect(hoisted.destroy).toHaveBeenCalledTimes(1);

    let waited = false;
    const waiting = waitForPayoutRun().then(() => {
      waited = true;
    });
    await flush();
    expect(waited).toBe(false);
    run.resolve();
    await execution;
    await waiting;
  });
});
