import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  relayOutboxBatch: vi.fn(),
  refreshOutboxStats: vi.fn(),
  sweepPublishedOutboxEvents: vi.fn(),
  logOutboxLag: vi.fn(),
  logOutboxRelayFailure: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/modules/outbox/services/outbox.service.js", () => hoisted);

const { startOutboxRelay, stopOutboxRelay, waitForOutboxRelayRun } =
  await import("@/modules/outbox/outbox.cron.js");

const emptyBatch = { claimed: 0 };

const deferred = () => {
  let resolve: (value: typeof emptyBatch) => void = () => undefined;
  const promise = new Promise<typeof emptyBatch>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hoisted.relayOutboxBatch.mockResolvedValue(emptyBatch);
  hoisted.refreshOutboxStats.mockResolvedValue({
    pending: 0,
    oldestPendingAgeMs: 0,
    dead: 0,
  });
  hoisted.sweepPublishedOutboxEvents.mockResolvedValue(0);
});

afterEach(async () => {
  stopOutboxRelay();
  await flush(5_000);
  vi.useRealTimers();
});

describe("outbox relay loop", () => {
  it("runs one tick per idle interval", async () => {
    startOutboxRelay();
    await flush(0);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(1);

    await flush(1_000);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps a single loop when restarted while a tick is in flight", async () => {
    const inFlight = deferred();
    hoisted.relayOutboxBatch.mockReturnValueOnce(inFlight.promise);

    startOutboxRelay();
    await flush(0);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(1);

    stopOutboxRelay();
    startOutboxRelay();
    await flush(0);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(1);

    inFlight.resolve(emptyBatch);
    await waitForOutboxRelayRun();
    await flush(0);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(1);

    await flush(1_000);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(2);
    await flush(1_000);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(3);
    await flush(1_000);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(4);
  });

  it("does not reschedule after stop once the in-flight tick ends", async () => {
    const inFlight = deferred();
    hoisted.relayOutboxBatch.mockReturnValueOnce(inFlight.promise);

    startOutboxRelay();
    await flush(0);
    stopOutboxRelay();
    inFlight.resolve(emptyBatch);
    await waitForOutboxRelayRun();
    await flush(5_000);

    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh loop when restarted after the in-flight tick ended", async () => {
    startOutboxRelay();
    await flush(0);
    stopOutboxRelay();
    await waitForOutboxRelayRun();

    startOutboxRelay();
    await flush(0);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(2);
    await flush(1_000);
    expect(hoisted.relayOutboxBatch).toHaveBeenCalledTimes(3);
  });
});
