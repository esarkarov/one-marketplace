import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  flags: { outboxMode: "off", telemetryMode: "off" },
  isRabbitEnabled: vi.fn(),
  isRabbitConnected: vi.fn(),
  sendNotification: vi.fn(),
  insertOutboxEvent: vi.fn(),
  claimOutboxEvents: vi.fn(),
  markOutboxEventPublished: vi.fn(),
  scheduleOutboxEventRetry: vi.fn(),
  markOutboxEventDead: vi.fn(),
  releaseOutboxEvent: vi.fn(),
  readOutboxStats: vi.fn(),
  deletePublishedOutboxEvents: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/config/env.js", () => ({
  env: {
    get outboxMode() {
      return hoisted.flags.outboxMode;
    },
    get telemetryMode() {
      return hoisted.flags.telemetryMode;
    },
  },
}));
vi.mock("@/config/logger.js", () => ({
  logger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: hoisted.warn,
    error: hoisted.error,
  },
}));
vi.mock("@/database/client.js", () => ({ db: { name: "db" } }));
vi.mock("@/infrastructure/events/rabbitmq.client.js", () => ({
  isRabbitEnabled: hoisted.isRabbitEnabled,
  isRabbitConnected: hoisted.isRabbitConnected,
}));
vi.mock("@/infrastructure/events/notification.publisher.js", () => ({
  sendNotification: hoisted.sendNotification,
}));
vi.mock("@/modules/outbox/repositories/outbox.repository.js", () => ({
  insertOutboxEvent: hoisted.insertOutboxEvent,
  claimOutboxEvents: hoisted.claimOutboxEvents,
  markOutboxEventPublished: hoisted.markOutboxEventPublished,
  scheduleOutboxEventRetry: hoisted.scheduleOutboxEventRetry,
  markOutboxEventDead: hoisted.markOutboxEventDead,
  releaseOutboxEvent: hoisted.releaseOutboxEvent,
  readOutboxStats: hoisted.readOutboxStats,
  deletePublishedOutboxEvents: hoisted.deletePublishedOutboxEvents,
}));

const {
  enqueueNotification,
  enqueueNotificationAfterCommit,
  outboxBackoffMs,
  relayOutboxBatch,
  sendUnlessQueued,
} = await import("@/modules/outbox/services/outbox.service.js");

const { OutboxPayloadError } =
  await import("@/modules/outbox/utils/outbox.errors.js");

const EVENT_ID = "0b6c5a3e-6f1d-5b6e-9c2a-1f3e4d5c6b7a";

const payload = {
  recipientId: "user_1",
  type: "PROPOSAL_RECEIVED",
  title: "New proposal",
  message: "You received a proposal.",
  link: "/jobs/1",
};

const claimed = (attempts: number, overrides: object = {}) => ({
  id: "row-1",
  eventId: EVENT_ID,
  payload,
  traceparent: null,
  attempts,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.flags.outboxMode = "off";
  hoisted.flags.telemetryMode = "off";
  hoisted.isRabbitEnabled.mockReturnValue(true);
  hoisted.isRabbitConnected.mockReturnValue(true);
  hoisted.insertOutboxEvent.mockResolvedValue(true);
  hoisted.markOutboxEventPublished.mockResolvedValue(true);
  hoisted.scheduleOutboxEventRetry.mockResolvedValue(true);
  hoisted.markOutboxEventDead.mockResolvedValue(true);
  hoisted.releaseOutboxEvent.mockResolvedValue(true);
  hoisted.warn.mockResolvedValue(undefined);
  hoisted.error.mockResolvedValue(undefined);
});

describe("enqueueNotification", () => {
  const executor = { name: "tx" } as never;
  const input = { ...payload, eventId: EVENT_ID };

  it("inserts nothing and returns false when the mode is off", async () => {
    expect(await enqueueNotification(executor, input)).toBe(false);
    expect(hoisted.insertOutboxEvent).not.toHaveBeenCalled();
  });

  it("inserts the row and returns false in shadow mode", async () => {
    hoisted.flags.outboxMode = "shadow";

    expect(await enqueueNotification(executor, input)).toBe(false);
    expect(hoisted.insertOutboxEvent).toHaveBeenCalledWith(executor, {
      eventId: EVENT_ID,
      payload,
      traceparent: null,
    });
  });

  it("inserts the row and returns true in on mode", async () => {
    hoisted.flags.outboxMode = "on";

    expect(await enqueueNotification(executor, input)).toBe(true);
    expect(hoisted.insertOutboxEvent).toHaveBeenCalledTimes(1);
  });

  it.each(["shadow", "on"])(
    "treats %s as off when RabbitMQ is not enabled",
    async (mode) => {
      hoisted.flags.outboxMode = mode;
      hoisted.isRabbitEnabled.mockReturnValue(false);

      expect(await enqueueNotification(executor, input)).toBe(false);
      expect(hoisted.insertOutboxEvent).not.toHaveBeenCalled();
    },
  );

  it("stores no traceparent when telemetry is off", async () => {
    hoisted.flags.outboxMode = "on";

    await enqueueNotification(executor, input);

    expect(hoisted.insertOutboxEvent.mock.calls[0]?.[1]).toMatchObject({
      traceparent: null,
    });
  });
});

describe("enqueueNotification payload validation", () => {
  const executor = { name: "tx" } as never;

  const malformed = [
    ["no title", { recipientId: "user_1", type: "X", message: "m" }],
    ["no target", { type: "X", title: "t", message: "m" }],
    [
      "a non-uuid agency id",
      { agencyId: "agency-1", type: "X", title: "t", message: "m" },
    ],
    [
      "a float amount in metadata",
      { ...payload, metadata: { amountCents: 12.5 } },
    ],
    ["a dollar amount in metadata", { ...payload, metadata: { amount: 10 } }],
  ] as const;

  it.each(["shadow", "on"])(
    "rejects every malformed payload in %s mode and inserts nothing",
    async (mode) => {
      hoisted.flags.outboxMode = mode;
      for (const [, bad] of malformed) {
        await expect(
          enqueueNotification(executor, {
            ...(bad as typeof payload),
            eventId: EVENT_ID,
          }),
        ).rejects.toBeInstanceOf(OutboxPayloadError);
      }
      expect(hoisted.insertOutboxEvent).not.toHaveBeenCalled();
    },
  );

  it("does not validate when the mode is off, so off stays as today", async () => {
    await expect(
      enqueueNotification(executor, {
        ...(malformed[0][1] as typeof payload),
        eventId: EVENT_ID,
      }),
    ).resolves.toBe(false);
  });

  it("accepts a valid agency payload with cents metadata", async () => {
    hoisted.flags.outboxMode = "on";
    const agencyPayload = {
      agencyId: "5f0b8a52-3a3c-4d0e-9a51-0c3b2f6e7d10",
      type: "MILESTONE_ADDED",
      title: "t",
      message: "m",
      metadata: { amountCents: 1500 },
    };

    await expect(
      enqueueNotification(executor, { ...agencyPayload, eventId: EVENT_ID }),
    ).resolves.toBe(true);
    expect(hoisted.insertOutboxEvent).toHaveBeenCalledWith(executor, {
      eventId: EVENT_ID,
      payload: agencyPayload,
      traceparent: null,
    });
  });
});

describe("enqueueNotificationAfterCommit", () => {
  const input = { ...payload, eventId: EVENT_ID };

  it("returns the mode result after inserting with the pool", async () => {
    hoisted.flags.outboxMode = "on";

    expect(await enqueueNotificationAfterCommit(input)).toBe(true);
    expect(hoisted.insertOutboxEvent).toHaveBeenCalledWith(
      { name: "db" },
      expect.objectContaining({ eventId: EVENT_ID }),
    );
  });

  it("logs outbox.enqueue.failed and returns false so the caller sends directly", async () => {
    hoisted.flags.outboxMode = "on";
    hoisted.insertOutboxEvent.mockRejectedValue(new Error("db down"));

    expect(await enqueueNotificationAfterCommit(input)).toBe(false);
    expect(hoisted.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "outbox.enqueue.failed",
        attributes: expect.objectContaining({
          "notification.type": "PROPOSAL_RECEIVED",
        }),
      }),
    );
  });

  it("returns false for a malformed payload instead of throwing", async () => {
    hoisted.flags.outboxMode = "on";

    expect(
      await enqueueNotificationAfterCommit({
        type: "X",
        title: "t",
        message: "m",
        eventId: EVENT_ID,
      } as typeof input),
    ).toBe(false);
    expect(hoisted.insertOutboxEvent).not.toHaveBeenCalled();
  });
});

describe("sendUnlessQueued", () => {
  it("sends directly when the event was not queued", async () => {
    await sendUnlessQueued(false, { ...payload, eventId: EVENT_ID });
    expect(hoisted.sendNotification).toHaveBeenCalledWith({
      ...payload,
      eventId: EVENT_ID,
    });
  });

  it("does not send when the event was queued", async () => {
    await sendUnlessQueued(true, { ...payload, eventId: EVENT_ID });
    expect(hoisted.sendNotification).not.toHaveBeenCalled();
  });
});

describe("outboxBackoffMs", () => {
  it("doubles from 5 s and caps at 10 minutes", () => {
    expect([1, 2, 3, 4, 7, 8, 9, 10].map(outboxBackoffMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 320_000, 600_000, 600_000, 600_000,
    ]);
  });
});

describe("relayOutboxBatch", () => {
  it("claims nothing while the broker is not connected", async () => {
    hoisted.isRabbitConnected.mockReturnValue(false);

    const result = await relayOutboxBatch();

    expect(result.claimed).toBe(0);
    expect(hoisted.claimOutboxEvents).not.toHaveBeenCalled();
  });

  it("claims with the batch size and lease", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([]);

    await relayOutboxBatch();

    expect(hoisted.claimOutboxEvents).toHaveBeenCalledWith(
      { name: "db" },
      { limit: 50, leaseMs: 60_000 },
    );
  });

  it("sends with the stored event id and marks published with the claimed attempts", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(3)]);
    hoisted.sendNotification.mockResolvedValue("published");

    const result = await relayOutboxBatch();

    expect(hoisted.sendNotification).toHaveBeenCalledWith({
      ...payload,
      eventId: EVENT_ID,
    });
    expect(hoisted.markOutboxEventPublished).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      3,
    );
    expect(result).toMatchObject({ claimed: 1, published: 1 });
  });

  it.each([
    [1, 5_000],
    [2, 10_000],
    [9, 600_000],
  ])(
    "schedules a retry after failure on attempt %i with a %i ms backoff",
    async (attempts, delay) => {
      hoisted.claimOutboxEvents.mockResolvedValue([claimed(attempts)]);
      hoisted.sendNotification.mockResolvedValue("failed");

      const result = await relayOutboxBatch();

      expect(hoisted.scheduleOutboxEventRetry).toHaveBeenCalledWith(
        { name: "db" },
        "row-1",
        attempts,
        delay,
        "publish_failed",
      );
      expect(hoisted.markOutboxEventDead).not.toHaveBeenCalled();
      expect(result.retried).toBe(1);
    },
  );

  it("records a thrown send as a failure with a short error code", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(1)]);
    hoisted.sendNotification.mockRejectedValue(
      Object.assign(new Error("boom"), { name: "TypeError" }),
    );

    await relayOutboxBatch();

    expect(hoisted.scheduleOutboxEventRetry).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      1,
      5_000,
      "TypeError",
    );
  });

  it("moves the tenth failure to DEAD and logs outbox.event.dead", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(10)]);
    hoisted.sendNotification.mockResolvedValue("failed");

    const result = await relayOutboxBatch();

    expect(hoisted.markOutboxEventDead).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      10,
      "publish_failed",
    );
    expect(hoisted.scheduleOutboxEventRetry).not.toHaveBeenCalled();
    expect(hoisted.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "outbox.event.dead" }),
    );
    expect(result.dead).toBe(1);
  });

  it("moves an invalid payload to DEAD without sending", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([
      claimed(1, { payload: { type: "X" } }),
    ]);

    await relayOutboxBatch();

    expect(hoisted.sendNotification).not.toHaveBeenCalled();
    expect(hoisted.markOutboxEventDead).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      1,
      "invalid_payload",
    );
  });

  it("releases the row without counting the attempt when sending is disabled", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(4)]);
    hoisted.sendNotification.mockResolvedValue("disabled");

    const result = await relayOutboxBatch();

    expect(hoisted.releaseOutboxEvent).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      4,
      1_000,
    );
    expect(hoisted.markOutboxEventPublished).not.toHaveBeenCalled();
    expect(hoisted.scheduleOutboxEventRetry).not.toHaveBeenCalled();
    expect(hoisted.markOutboxEventDead).not.toHaveBeenCalled();
    expect(result.released).toBe(1);
  });

  it("counts a guarded mark that changed nothing as stale and logs it", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(2)]);
    hoisted.sendNotification.mockResolvedValue("published");
    hoisted.markOutboxEventPublished.mockResolvedValue(false);

    const result = await relayOutboxBatch();

    expect(result).toMatchObject({ published: 0, stale: 1 });
    expect(hoisted.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "outbox.relay.lease_lost" }),
    );
  });

  it("releases the rest of the batch without counting attempts when the broker drops mid-batch", async () => {
    hoisted.isRabbitConnected
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    hoisted.claimOutboxEvents.mockResolvedValue([
      claimed(1, { id: "row-1" }),
      claimed(2, { id: "row-2" }),
      claimed(3, { id: "row-3" }),
    ]);
    hoisted.sendNotification.mockResolvedValue("published");

    const result = await relayOutboxBatch();

    expect(hoisted.sendNotification).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseOutboxEvent.mock.calls).toEqual([
      [{ name: "db" }, "row-2", 2, 0],
      [{ name: "db" }, "row-3", 3, 0],
    ]);
    expect(hoisted.scheduleOutboxEventRetry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 3, published: 1, released: 2 });
  });

  it("stops at the first publish failure and releases the unsent rows", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([
      claimed(1, { id: "row-1" }),
      claimed(1, { id: "row-2" }),
      claimed(4, { id: "row-3" }),
    ]);
    hoisted.sendNotification.mockResolvedValue("failed");

    const result = await relayOutboxBatch();

    expect(hoisted.sendNotification).toHaveBeenCalledTimes(1);
    expect(hoisted.scheduleOutboxEventRetry).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseOutboxEvent.mock.calls).toEqual([
      [{ name: "db" }, "row-2", 1, 0],
      [{ name: "db" }, "row-3", 4, 0],
    ]);
    expect(result).toMatchObject({ retried: 1, released: 2 });
  });

  it("releases the rest once the batch has used its time budget", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(30_000);
    hoisted.claimOutboxEvents.mockResolvedValue([
      claimed(1, { id: "row-1" }),
      claimed(1, { id: "row-2" }),
    ]);
    hoisted.sendNotification.mockResolvedValue("published");

    const result = await relayOutboxBatch();
    now.mockRestore();

    expect(hoisted.sendNotification).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseOutboxEvent.mock.calls).toEqual([
      [{ name: "db" }, "row-2", 1, 0],
    ]);
    expect(result).toMatchObject({ published: 1, released: 1 });
  });

  it("moves a row reclaimed past the attempt limit to DEAD without sending", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(11)]);

    const result = await relayOutboxBatch();

    expect(hoisted.sendNotification).not.toHaveBeenCalled();
    expect(hoisted.markOutboxEventDead).toHaveBeenCalledWith(
      { name: "db" },
      "row-1",
      11,
      "lease_expired_after_max_attempts",
    );
    expect(result.dead).toBe(1);
  });

  it("logs a database error on a mark and leaves the rest of the batch to its lease", async () => {
    hoisted.claimOutboxEvents.mockResolvedValue([
      claimed(1, { id: "row-1" }),
      claimed(1, { id: "row-2" }),
    ]);
    hoisted.sendNotification.mockResolvedValue("published");
    hoisted.markOutboxEventPublished.mockRejectedValue(
      new Error("connection terminated"),
    );

    const result = await relayOutboxBatch();

    expect(hoisted.sendNotification).toHaveBeenCalledTimes(1);
    expect(hoisted.releaseOutboxEvent).not.toHaveBeenCalled();
    expect(hoisted.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "outbox.relay.failed" }),
    );
    expect(result).toMatchObject({ claimed: 2, published: 0 });
  });

  it("uses an injected sender and readiness check", async () => {
    const send = vi.fn().mockResolvedValue("published");
    hoisted.isRabbitConnected.mockReturnValue(false);
    hoisted.claimOutboxEvents.mockResolvedValue([claimed(1)]);

    const result = await relayOutboxBatch({ send, isReady: () => true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(hoisted.sendNotification).not.toHaveBeenCalled();
    expect(result.published).toBe(1);
  });
});
