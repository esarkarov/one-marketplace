import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  checkQueue: vi.fn(),
  resetChannel: vi.fn(),
}));

vi.mock("@/config/logger.js", () => ({
  logger: { warn: mocks.warn },
}));

vi.mock("./rabbitmq.client.js", () => ({
  getRabbitMonitorChannel: () => ({ checkQueue: mocks.checkQueue }),
  resetRabbitMonitorChannel: mocks.resetChannel,
}));

const {
  createDeadLetterMonitor,
  startDeadLetterMonitor,
  stopDeadLetterMonitor,
} = await import("./notification.monitor.js");

const events = () => mocks.warn.mock.calls.map((call) => call[0].eventName);

const build = (
  extra: Partial<Parameters<typeof createDeadLetterMonitor>[0]> = {},
) =>
  createDeadLetterMonitor({
    getChannel: () => ({ checkQueue: mocks.checkQueue }),
    resetChannel: mocks.resetChannel,
    ...extra,
  });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.warn.mockReset().mockResolvedValue(undefined);
  mocks.checkQueue.mockReset();
  mocks.resetChannel.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await stopDeadLetterMonitor();
  vi.useRealTimers();
});

describe("dead-letter monitor", () => {
  it("logs nothing when the queue is empty", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 0 });
    const monitor = build();

    await monitor.check();

    expect(mocks.checkQueue).toHaveBeenCalledWith("notifications.dead");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.resetChannel).not.toHaveBeenCalled();
  });

  it("warns with the depth when the queue is not empty", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 3 });
    const monitor = build();

    await monitor.check();

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]![0]).toMatchObject({
      eventName: "queue.dead_letter.nonempty",
      attributes: { depth: 3 },
    });
  });

  it("does not repeat an unchanged depth inside the window and repeats after it", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 3 });
    let clock = 1_000;
    const monitor = build({ now: () => clock });

    await monitor.check();
    clock += 9 * 60_000;
    await monitor.check();
    expect(events()).toEqual(["queue.dead_letter.nonempty"]);

    clock += 60_000;
    await monitor.check();
    expect(events()).toEqual([
      "queue.dead_letter.nonempty",
      "queue.dead_letter.nonempty",
    ]);
  });

  it("logs immediately when the depth changes", async () => {
    let clock = 1_000;
    const monitor = build({ now: () => clock });

    mocks.checkQueue.mockResolvedValue({ messageCount: 3 });
    await monitor.check();
    clock += 60_000;
    mocks.checkQueue.mockResolvedValue({ messageCount: 4 });
    await monitor.check();

    expect(
      mocks.warn.mock.calls.map((call) => call[0].attributes.depth),
    ).toEqual([3, 4]);
  });

  it("logs again right away when the queue refills after being drained", async () => {
    let clock = 1_000;
    const monitor = build({ now: () => clock });

    mocks.checkQueue.mockResolvedValue({ messageCount: 2 });
    await monitor.check();
    clock += 60_000;
    mocks.checkQueue.mockResolvedValue({ messageCount: 0 });
    await monitor.check();
    clock += 60_000;
    mocks.checkQueue.mockResolvedValue({ messageCount: 2 });
    await monitor.check();

    expect(events()).toEqual([
      "queue.dead_letter.nonempty",
      "queue.dead_letter.nonempty",
    ]);
  });

  it("logs a failed check at most once per throttle window", async () => {
    mocks.checkQueue.mockRejectedValue(new Error("channel closed"));
    let clock = 1_000;
    const monitor = build({ now: () => clock });

    await monitor.check();
    clock += 9 * 60_000;
    await monitor.check();
    expect(events()).toEqual(["queue.dead_letter.check_failed"]);

    clock += 60_000;
    await monitor.check();
    expect(events()).toEqual([
      "queue.dead_letter.check_failed",
      "queue.dead_letter.check_failed",
    ]);
  });

  it("does not throw when the warn logger rejects", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 1 });
    mocks.warn.mockRejectedValue(new Error("log down"));
    const monitor = build();

    await expect(monitor.check()).resolves.toBeUndefined();
  });

  it("recreates the channel after a failed check and reports depth on the next one", async () => {
    let channelGeneration = 0;
    const channels = [
      { checkQueue: vi.fn().mockRejectedValue(new Error("Not connected.")) },
      { checkQueue: vi.fn().mockResolvedValue({ messageCount: 5 }) },
    ];
    const resetChannel = vi.fn(async () => {
      channelGeneration += 1;
    });
    const monitor = createDeadLetterMonitor({
      getChannel: () => channels[channelGeneration]!,
      resetChannel,
    });

    await monitor.check();
    expect(resetChannel).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(["queue.dead_letter.check_failed"]);

    await monitor.check();
    expect(channels[1]!.checkQueue).toHaveBeenCalledWith("notifications.dead");
    expect(resetChannel).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      "queue.dead_letter.check_failed",
      "queue.dead_letter.nonempty",
    ]);
    expect(mocks.warn.mock.calls[1]![0].attributes.depth).toBe(5);
  });

  it("survives a failing channel reset", async () => {
    mocks.checkQueue.mockRejectedValue(new Error("down"));
    mocks.resetChannel.mockRejectedValue(new Error("close failed"));
    const monitor = build();

    await expect(monitor.check()).resolves.toBeUndefined();
  });

  it("checks on every interval and stops checking after stop", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 0 });
    startDeadLetterMonitor();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.checkQueue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.checkQueue).toHaveBeenCalledTimes(2);

    await stopDeadLetterMonitor();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.checkQueue).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a second timer when started twice", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 0 });
    startDeadLetterMonitor();
    startDeadLetterMonitor();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.checkQueue).toHaveBeenCalledTimes(1);
  });

  it("skips a check while the previous one is still running", async () => {
    let release!: (value: { messageCount: number }) => void;
    mocks.checkQueue.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const monitor = build();

    const first = monitor.check();
    await monitor.check();
    release({ messageCount: 0 });
    await first;

    expect(mocks.checkQueue).toHaveBeenCalledTimes(1);
  });

  it("stop waits for an in-flight check to finish", async () => {
    let release!: (value: { messageCount: number }) => void;
    mocks.checkQueue.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const monitor = build();
    void monitor.check();

    let stopped = false;
    const stopping = monitor.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stopped).toBe(false);

    release({ messageCount: 0 });
    await stopping;
    expect(stopped).toBe(true);
  });

  it("stop gives up on a hung check after the timeout", async () => {
    mocks.checkQueue.mockReturnValue(new Promise(() => undefined));
    const monitor = build();
    void monitor.check();

    let stopped = false;
    const stopping = monitor.stop(2_000).then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toBe(true);
  });

  it("does not reset the channel when a check fails after stop gave up", async () => {
    let fail!: (error: Error) => void;
    mocks.checkQueue.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const monitor = build();
    void monitor.check();

    const stopping = monitor.stop(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
    fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.resetChannel).not.toHaveBeenCalled();
  });

  it("runs no check after stop", async () => {
    mocks.checkQueue.mockResolvedValue({ messageCount: 1 });
    const monitor = build();

    await monitor.stop();
    await monitor.check();

    expect(mocks.checkQueue).not.toHaveBeenCalled();
  });
});
