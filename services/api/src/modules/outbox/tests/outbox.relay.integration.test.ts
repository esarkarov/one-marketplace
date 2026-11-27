import { randomUUID } from "node:crypto";
import type { ChannelWrapper } from "amqp-connection-manager";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/database/client.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  createRabbitChannel,
  createRabbitConnection,
} from "@/infrastructure/events/rabbitmq.client.js";
import { createNotificationEnvelope } from "@/infrastructure/events/notification.envelope.js";
import { publishNotificationEnvelope } from "@/infrastructure/events/notification.publisher.js";
import { topologyNames } from "@/infrastructure/events/notification.topology.js";
import type { NotificationInput } from "@/infrastructure/types/index.js";
import { createNotificationConsumer } from "@/modules/notifications/notifications.consumer.js";
import { insertOutboxEvent } from "@/modules/outbox/repositories/outbox.repository.js";
import { relayOutboxBatch } from "@/modules/outbox/services/outbox.service.js";

const url = process.env.INTEGRATION_RABBITMQ_URL;
const isLocal = (() => {
  try {
    const host = new URL(url ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
})();

const prefix = `it-outbox-${randomUUID().slice(0, 8)}.`;
const names = topologyNames(prefix);
const recipientId = `outbox-it-${randomUUID()}`;

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

describe.skipIf(!url || !isLocal)("outbox relay with a real broker", () => {
  let connection: ReturnType<typeof createRabbitConnection>;
  let publisher: ChannelWrapper;
  let consumerChannel: ChannelWrapper;
  let consumer: ReturnType<typeof createNotificationConsumer>;

  const notificationCount = async (eventId: string) =>
    Number(
      (
        await pool.query<{ n: number }>(
          "select count(*)::int as n from notifications where event_id = $1",
          [eventId],
        )
      ).rows[0]?.n ?? 0,
    );

  beforeAll(async () => {
    assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
    await pool.query("delete from outbox_events");
    connection = createRabbitConnection(url!);
    publisher = createRabbitChannel(connection, "it-outbox-publisher", {
      prefix,
    });
    consumerChannel = createRabbitChannel(connection, "it-outbox-consumer", {
      prefix,
    });
    await Promise.all([
      publisher.waitForConnect(),
      consumerChannel.waitForConnect(),
    ]);
    consumer = createNotificationConsumer({ channel: consumerChannel, prefix });
    await consumer.start();
  }, 20_000);

  afterAll(async () => {
    await pool.query("delete from outbox_events");
    await pool.query("delete from notifications where recipient_id = $1", [
      recipientId,
    ]);
    if (!connection) return;
    await consumer?.stop(1_000);
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

  it("relaying the same row twice still yields exactly one notifications row", async () => {
    const eventId = randomUUID();
    await insertOutboxEvent(db, {
      eventId,
      payload: {
        recipientId,
        type: "PROPOSAL_RECEIVED",
        title: "New proposal",
        message: "You received a proposal.",
      },
      traceparent: null,
    });
    const send = vi.fn(async (input: NotificationInput) => {
      await publishNotificationEnvelope(
        publisher,
        createNotificationEnvelope(input),
        prefix,
      );
      return "published" as const;
    });
    const deps = { send, isReady: () => true };

    expect(await relayOutboxBatch(deps)).toMatchObject({
      claimed: 1,
      published: 1,
    });
    await pool.query(
      "update outbox_events set status = 'PENDING', published_at = null where event_id = $1",
      [eventId],
    );
    expect(await relayOutboxBatch(deps)).toMatchObject({
      claimed: 1,
      published: 1,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([input]) => input.eventId)).toEqual([
      eventId,
      eventId,
    ]);
    await waitFor(
      async () =>
        (await publisher.checkQueue(names.storageQueue)).messageCount === 0 &&
        (await notificationCount(eventId)) === 1,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await notificationCount(eventId)).toBe(1);
    expect(
      (await publisher.checkQueue(names.deadLetterQueue)).messageCount,
    ).toBe(0);
  });
});
