import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsumeMessage } from "amqplib";
import { createNotificationEnvelope } from "../../infrastructure/events/envelope.js";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  values: vi.fn(),
  execute: vi.fn(),
  emit: vi.fn(),
  emitAgency: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("../../config/logger.js", () => ({
  logger: { error: mocks.logError, info: mocks.logInfo },
}));

vi.mock("../../infrastructure/rabbitmq.js", () => ({
  getRabbitConsumerChannel: vi.fn(),
}));

vi.mock("../../database/client.js", () => ({
  db: {
    insert: () => ({
      values: (value: unknown) => {
        mocks.values(value);
        return {
          onConflictDoNothing: () => ({ returning: mocks.returning }),
        };
      },
    }),
    execute: mocks.execute,
  },
}));

vi.mock("./notifications.sse.js", () => ({
  emitNotification: mocks.emit,
  emitAgencyNotification: mocks.emitAgency,
}));

const { createNotificationConsumer } =
  await import("./notifications.consumer.js");

type Handler = (message: ConsumeMessage) => void;

const setup = () => {
  let handler: Handler = () => undefined;
  const channel = {
    consume: vi.fn(async (_queue: string, onMessage: Handler) => {
      handler = onMessage;
      return { consumerTag: "tag-1" };
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    nack: vi.fn(),
  };
  const consumer = createNotificationConsumer({
    channel: channel as never,
  });
  return { channel, consumer, deliver: (m: ConsumeMessage) => handler(m) };
};

const message = (content: unknown): ConsumeMessage =>
  ({
    content: Buffer.from(
      typeof content === "string" ? content : JSON.stringify(content),
    ),
  }) as ConsumeMessage;

const envelope = () =>
  createNotificationEnvelope({
    recipientId: "user_1",
    type: "PROPOSAL_RECEIVED",
    title: "Title",
    message: "Body",
    link: "/x",
    metadata: { a: 1 },
  });

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notification consumer", () => {
  it("subscribes to the storage queue with prefetch 10 and manual ack", async () => {
    const { channel, consumer } = setup();
    await consumer.start();

    expect(channel.consume).toHaveBeenCalledWith(
      "notifications.storage",
      expect.any(Function),
      { prefetch: 10, noAck: false },
    );
  });

  it("inserts one row with event_id = envelope id, acks, then emits", async () => {
    const { channel, consumer, deliver } = setup();
    const env = envelope();
    const row = { id: "n1", agency_id: null, recipient_id: "user_1" };
    mocks.returning.mockResolvedValue([row]);
    await consumer.start();

    deliver(message(env));
    await consumer.stop();

    expect(mocks.values).toHaveBeenCalledTimes(1);
    expect(mocks.values.mock.calls[0]![0]).toMatchObject({
      event_id: env.id,
      recipient_id: "user_1",
      agency_id: null,
      type: "PROPOSAL_RECEIVED",
      created_at: new Date(env.occurredAt),
    });
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith("user_1", row);
  });

  it("emits to the agency channel for agency notifications", async () => {
    const { consumer, deliver } = setup();
    const agencyId = "3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b";
    const row = { id: "n1", agency_id: agencyId, recipient_id: null };
    mocks.returning.mockResolvedValue([row]);
    await consumer.start();

    deliver(
      message(
        createNotificationEnvelope({
          agencyId,
          type: "T",
          title: "a",
          message: "b",
        }),
      ),
    );
    await consumer.stop();

    expect(mocks.emitAgency).toHaveBeenCalledWith(agencyId, row);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("acks a duplicate without emitting", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockResolvedValue([]);
    await consumer.start();

    deliver(message(envelope()));
    await consumer.stop();

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.emitAgency).not.toHaveBeenCalled();
  });

  it.each([
    ["not json", "{nope"],
    ["wrong shape", { id: "x" }],
  ])("rejects %s without requeue", async (_name, content) => {
    const { channel, consumer, deliver } = setup();
    await consumer.start();

    const msg = message(content);
    deliver(msg);
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
  });

  const v1 = (metadata?: Record<string, unknown>) => ({
    ...envelope(),
    version: 1,
    payload: { ...envelope().payload, metadata },
  });

  it("stores a v1 amount as amountCents and acks", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockResolvedValue([]);
    await consumer.start();

    deliver(message(v1({ amount: 19.99, contractId: "c" })));
    await consumer.stop();

    expect(mocks.values.mock.calls[0]![0].metadata).toEqual({
      amountCents: 1999,
      contractId: "c",
    });
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a v1 amount with three decimals without requeue", async () => {
    const { channel, consumer, deliver } = setup();
    await consumer.start();

    const msg = message(v1({ amount: 1.005 }));
    deliver(msg);
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("dead-letters integrity violations instead of requeueing", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(
      Object.assign(new Error("fk"), { code: "23503" }),
    );
    await consumer.start();

    const msg = message(envelope());
    deliver(msg);
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it("requeues on a database error, pauses, and resumes after a successful ping", async () => {
    vi.useFakeTimers();
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("connection refused"));
    mocks.execute.mockRejectedValueOnce(new Error("down"));
    mocks.execute.mockResolvedValue([]);
    await consumer.start();

    const msg = message(envelope());
    deliver(msg);
    await flush();

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.cancel).toHaveBeenCalledWith("tag-1");
    expect(channel.consume).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(channel.consume).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(channel.consume).toHaveBeenCalledTimes(2);

    await consumer.stop();
  });

  it("logs started, paused and resumed at info level without urls or error text", async () => {
    vi.useFakeTimers();
    const { consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("secret db failure"));
    mocks.execute.mockResolvedValue([]);

    await consumer.start();
    expect(mocks.logInfo).toHaveBeenLastCalledWith({
      message: "Notification consumer started",
      eventName: "queue.consumer.started",
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "notifications.storage",
      },
    });

    deliver(message(envelope()));
    await flush();
    expect(mocks.logInfo.mock.calls.map(([entry]) => entry.eventName)).toEqual([
      "queue.consumer.started",
      "queue.consumer.paused",
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.logInfo.mock.calls.map(([entry]) => entry.eventName)).toEqual([
      "queue.consumer.started",
      "queue.consumer.paused",
      "queue.consumer.resumed",
    ]);
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain("secret");

    await consumer.stop();
  });

  it("does not log resumed when the ping keeps failing", async () => {
    vi.useFakeTimers();
    const { consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("db down"));
    mocks.execute.mockRejectedValue(new Error("still down"));
    await consumer.start();

    deliver(message(envelope()));
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(
      mocks.logInfo.mock.calls.map(([entry]) => entry.eventName),
    ).not.toContain("queue.consumer.resumed");
    await consumer.stop();
  });

  it("does not fail message handling when the info logger rejects", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.logInfo.mockRejectedValue(new Error("log down"));
    mocks.returning.mockResolvedValue([
      { id: "n1", agency_id: null, recipient_id: "user_1" },
    ]);

    await consumer.start();
    deliver(message(envelope()));
    await consumer.stop();

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a message once it has failed deliveryLimit times", async () => {
    vi.useFakeTimers();
    const channel = {
      consume: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
    };
    let handler: (m: ConsumeMessage) => void = () => undefined;
    channel.consume.mockImplementation(async (_q: string, h: never) => {
      handler = h;
      return { consumerTag: "tag-1" };
    });
    const consumer = createNotificationConsumer({
      channel: channel as never,
      deliveryLimit: 2,
    });
    mocks.returning.mockRejectedValue(new Error("down"));
    mocks.execute.mockResolvedValue([]);
    await consumer.start();

    const msg = message(envelope());
    handler(msg);
    await flush();
    expect(channel.nack).toHaveBeenLastCalledWith(msg, false, true);

    await vi.advanceTimersByTimeAsync(1_000);
    handler(msg);
    await flush();
    expect(channel.nack).toHaveBeenLastCalledWith(msg, false, false);

    await consumer.stop();
  });

  it("does not resume after stop", async () => {
    vi.useFakeTimers();
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("down"));
    await consumer.start();

    deliver(message(envelope()));
    await flush();
    await consumer.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(channel.consume).toHaveBeenCalledTimes(1);
  });

  it("still nacks an invalid message when the logger rejects", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.logError.mockRejectedValue(new Error("log down"));
    await consumer.start();

    deliver(message("not json"));
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack.mock.calls[0]!.slice(1)).toEqual([false, false]);
  });

  it("still requeues a failed insert when the logger throws synchronously", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.logError.mockImplementation(() => {
      throw new Error("log down");
    });
    mocks.returning.mockRejectedValue(new Error("db down"));
    await consumer.start();

    deliver(message(envelope()));
    await flush();
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack.mock.calls[0]!.slice(1)).toEqual([false, true]);
  });

  it("requeues without touching the database when a delivery arrives after stop", async () => {
    const { channel, consumer, deliver } = setup();
    await consumer.start();
    await consumer.stop();

    deliver(message(envelope()));
    await flush();

    expect(mocks.values).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack.mock.calls[0]!.slice(1)).toEqual([false, true]);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it("forgets the oldest failing id once more than 1000 ids are tracked", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("db down"));
    await consumer.start();

    const first = message(envelope());
    for (let i = 0; i < 4; i++) {
      deliver(first);
      await flush();
    }
    for (let i = 0; i < 1_000; i++) {
      deliver(message(envelope()));
      await flush();
    }
    channel.nack.mockClear();

    deliver(first);
    await flush();
    await consumer.stop();

    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack.mock.calls[0]!.slice(1)).toEqual([false, true]);
  });

  it("keeps counting a recently failing id and dead-letters it at the limit", async () => {
    const { channel, consumer, deliver } = setup();
    mocks.returning.mockRejectedValue(new Error("db down"));
    await consumer.start();

    const first = message(envelope());
    for (let i = 0; i < 4; i++) {
      deliver(first);
      await flush();
    }
    channel.nack.mockClear();

    deliver(first);
    await flush();
    await consumer.stop();

    expect(channel.nack.mock.calls[0]!.slice(1)).toEqual([false, false]);
  });
});
