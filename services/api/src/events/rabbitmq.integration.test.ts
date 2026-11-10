import { randomUUID } from "node:crypto";
import type { ChannelWrapper } from "amqp-connection-manager";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  ids: new Set<string>(),
  failing: false,
  insertAttempts: 0,
  values: vi.fn(),
  emit: vi.fn(),
  emitAgency: vi.fn(),
}));

vi.mock("../database/client.js", () => ({
  db: {
    insert: () => ({
      values: (value: { event_id: string; recipient_id: string | null }) => {
        state.values(value);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              state.insertAttempts++;
              if (state.failing) throw new Error("database unavailable");
              if (state.ids.has(value.event_id)) return [];
              state.ids.add(value.event_id);
              return [{ ...value, id: randomUUID(), agency_id: null }];
            },
          }),
        };
      },
    }),
    execute: async () => [],
  },
}));

vi.mock("../modules/notifications/notification.sse.js", () => ({
  emitNotification: state.emit,
  emitAgencyNotification: state.emitAgency,
}));

const url = process.env.INTEGRATION_RABBITMQ_URL;
const isLocal = (() => {
  try {
    const host = new URL(url ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
})();

const { createRabbitChannel, createRabbitConnection } =
  await import("../config/rabbitmq.js");
const { createNotificationConsumer } = await import("./consumer.js");
const { createNotificationEnvelope } = await import("./envelope.js");
const { publishNotificationEnvelope } = await import("./publisher.js");
const { NOTIFICATIONS_CREATED_ROUTING_KEY, topologyNames } =
  await import("./topology.js");

const prefix = `it-${randomUUID().slice(0, 8)}.`;
const names = topologyNames(prefix);
const topology = { prefix, deliveryLimit: 2 };

const waitFor = async (
  check: () => Promise<boolean> | boolean,
  ms = 20_000,
) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition not met in time");
};

const newEnvelope = () =>
  createNotificationEnvelope({
    recipientId: "user_1",
    type: "PROPOSAL_RECEIVED",
    title: "Title",
    message: "Body",
  });

describe.skipIf(!url || !isLocal)("rabbitmq integration", () => {
  let connection: ReturnType<typeof createRabbitConnection>;
  let publisher: ChannelWrapper;
  let consumerChannel: ChannelWrapper;
  let consumer: ReturnType<typeof createNotificationConsumer> | undefined;

  const count = async (queue: string) =>
    (await publisher.checkQueue(queue)).messageCount;

  const startConsumer = async () => {
    consumer = createNotificationConsumer({
      channel: consumerChannel,
      prefix,
      deliveryLimit: topology.deliveryLimit,
    });
    await consumer.start();
  };

  beforeAll(async () => {
    connection = createRabbitConnection(url!);
    publisher = createRabbitChannel(connection, "it-publisher", topology);
    consumerChannel = createRabbitChannel(connection, "it-consumer", topology);
    await Promise.all([
      publisher.waitForConnect(),
      consumerChannel.waitForConnect(),
    ]);
  }, 20_000);

  beforeEach(async () => {
    state.ids.clear();
    state.failing = false;
    state.insertAttempts = 0;
    vi.clearAllMocks();
    await publisher.purgeQueue(names.storageQueue);
    await publisher.purgeQueue(names.deadLetterQueue);
  });

  afterEach(async () => {
    await consumer?.stop(1_000);
    consumer = undefined;
  });

  afterAll(async () => {
    if (!connection) return;
    await publisher.deleteQueue(names.storageQueue).catch(() => undefined);
    await publisher.deleteQueue(names.deadLetterQueue).catch(() => undefined);
    await publisher.deleteExchange(names.exchange).catch(() => undefined);
    await publisher
      .deleteExchange(names.deadLetterExchange)
      .catch(() => undefined);
    await publisher.close();
    await consumerChannel.close();
    await connection.close();
  }, 20_000);

  it("round trip: publishes, consumes, inserts once and acks", async () => {
    await startConsumer();
    const envelope = newEnvelope();

    await publishNotificationEnvelope(publisher, envelope, prefix);
    await waitFor(() => state.emit.mock.calls.length === 1);

    expect(state.values).toHaveBeenCalledTimes(1);
    expect(state.values.mock.calls[0]![0]).toMatchObject({
      event_id: envelope.id,
      recipient_id: "user_1",
    });
    await waitFor(async () => (await count(names.storageQueue)) === 0);
    expect(await count(names.deadLetterQueue)).toBe(0);
  });

  it("dead-letters a malformed message", async () => {
    await startConsumer();

    await publisher.publish(
      names.exchange,
      NOTIFICATIONS_CREATED_ROUTING_KEY,
      Buffer.from("{not json"),
      { persistent: true, contentType: "application/json" },
    );
    await waitFor(async () => (await count(names.deadLetterQueue)) === 1);

    expect(state.values).not.toHaveBeenCalled();
    expect(await count(names.storageQueue)).toBe(0);
  });

  it("dead-letters a message that keeps failing past the delivery limit", async () => {
    state.failing = true;
    await startConsumer();

    await publishNotificationEnvelope(publisher, newEnvelope(), prefix);
    await waitFor(
      async () => (await count(names.deadLetterQueue)) === 1,
      30_000,
    );

    expect(state.insertAttempts).toBeGreaterThanOrEqual(2);
    expect(state.emit).not.toHaveBeenCalled();
    expect(await count(names.storageQueue)).toBe(0);
  }, 40_000);

  it("inserts once when the same envelope is published twice", async () => {
    await startConsumer();
    const envelope = newEnvelope();

    await publishNotificationEnvelope(publisher, envelope, prefix);
    await publishNotificationEnvelope(publisher, envelope, prefix);
    await waitFor(() => state.insertAttempts === 2);
    await waitFor(async () => (await count(names.storageQueue)) === 0);

    expect(state.ids.size).toBe(1);
    expect(state.emit).toHaveBeenCalledTimes(1);
    expect(await count(names.deadLetterQueue)).toBe(0);
  });
});
