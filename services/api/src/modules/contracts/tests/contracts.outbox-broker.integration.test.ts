import { randomUUID } from "node:crypto";
import type { ChannelWrapper } from "amqp-connection-manager";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  emitConversationUpdate: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env } };
});

vi.mock(
  "@/infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "@/database/client.js";
import {
  createRabbitChannel,
  createRabbitConnection,
} from "@/infrastructure/events/rabbitmq.client.js";
import { createNotificationEnvelope } from "@/infrastructure/events/notification.envelope.js";
import { publishNotificationEnvelope } from "@/infrastructure/events/notification.publisher.js";
import { topologyNames } from "@/infrastructure/events/notification.topology.js";
import type { NotificationInput } from "@/infrastructure/types/index.js";
import { acceptOffer } from "@/modules/contracts/services/contracts.lifecycle.service.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import { createNotificationConsumer } from "@/modules/notifications/notifications.consumer.js";
import { relayOutboxBatch } from "@/modules/outbox/services/outbox.service.js";
import {
  accounts,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import {
  outboxRows,
  resetOutboxMode,
  setOutboxMode,
} from "@/test/support/outbox-mode.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";

const url = process.env.INTEGRATION_RABBITMQ_URL;
const isLocal = (() => {
  try {
    const host = new URL(url ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
})();

const PREFIX = "contracts-outbox-broker-it-";
const AMOUNT = 20000;
const prefix = `it-contracts-outbox-${randomUUID().slice(0, 8)}.`;
const names = topologyNames(prefix);

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

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    display_name: "Test User",
    role,
    identityVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const seedPendingContract = async () => {
  const clientId = await insertAccount("CLIENT");
  const ownerId = await insertAccount("FREELANCER");
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Broker job",
      description: "Broker test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: ownerId,
      sender_type: "FREELANCER",
      cover_letter: "broker test",
      bid_amount_cents: AMOUNT,
      duration: "1 week",
      status: "INTERVIEWED",
    })
    .returning({ id: proposals.id });
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: ownerId,
      title: "Broker contract",
      total_amount_cents: AMOUNT,
      status: "PENDING",
    })
    .returning({ id: contracts.id });
  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    {
      conversation_id: conversation!.id,
      account_id: ownerId,
      participant_type: "FREELANCER",
    },
  ]);
  await db.insert(contract_milestones).values({
    contract_id: contract!.id,
    title: "Milestone 1",
    amount_cents: AMOUNT,
    due_date: "2026-12-01",
    position: 0,
    status: "PENDING",
    funded_at: new Date(),
  });
  return { clientId, ownerId, contractId: contract!.id };
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from notifications where recipient_id like $1", [
    like,
  ]);
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const notificationsFor = async (eventIds: string[]) =>
  (
    await pool.query<{ event_id: string; recipient_id: string; type: string }>(
      "select event_id, recipient_id, type from notifications where event_id = any($1::text[])",
      [eventIds],
    )
  ).rows;

describe.skipIf(!url || !isLocal)(
  "CONTRACT_ACCEPTED through the outbox relay and a real broker",
  () => {
    let connection: ReturnType<typeof createRabbitConnection>;
    let publisher: ChannelWrapper;
    let consumerChannel: ChannelWrapper;
    let consumer: ReturnType<typeof createNotificationConsumer>;

    beforeAll(async () => {
      assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
      await pool.query("delete from outbox_events");
      await purge();
      mocks.emitConversationUpdate.mockResolvedValue(undefined);
      connection = createRabbitConnection(url!);
      publisher = createRabbitChannel(connection, "it-contracts-publisher", {
        prefix,
      });
      consumerChannel = createRabbitChannel(
        connection,
        "it-contracts-consumer",
        { prefix },
      );
      await Promise.all([
        publisher.waitForConnect(),
        consumerChannel.waitForConnect(),
      ]);
      consumer = createNotificationConsumer({
        channel: consumerChannel,
        prefix,
      });
      await consumer.start();
    }, 20_000);

    afterAll(async () => {
      resetOutboxMode();
      await pool.query("delete from outbox_events");
      await purge();
      if (connection) {
        await consumer?.stop(1_000);
        await publisher.deleteQueue(names.storageQueue).catch(() => undefined);
        await publisher
          .deleteQueue(names.deadLetterQueue)
          .catch(() => undefined);
        await publisher.deleteExchange(names.exchange).catch(() => undefined);
        await publisher
          .deleteExchange(names.deadLetterExchange)
          .catch(() => undefined);
        await publisher.close();
        await consumerChannel.close();
        await connection.close();
      }
      await pool.end();
    }, 20_000);

    it("mode on: accepting stores two rows, the relay publishes them and the consumer stores each notice once", async () => {
      setOutboxMode("on");
      const fixture = await seedPendingContract();
      const eventIds = [
        notificationEventId(
          "CONTRACT_ACCEPTED",
          fixture.contractId,
          "accepted-client",
        ),
        notificationEventId(
          "CONTRACT_ACCEPTED",
          fixture.contractId,
          "accepted-talent",
        ),
      ];

      await acceptOffer(fixture.ownerId, fixture.contractId, undefined);

      expect(mocks.sendNotification).not.toHaveBeenCalled();
      expect(await outboxRows(eventIds)).toHaveLength(2);

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
        claimed: 2,
        published: 2,
      });
      await pool.query(
        "update outbox_events set status = 'PENDING', published_at = null where event_id = any($1::uuid[])",
        [eventIds],
      );
      expect(await relayOutboxBatch(deps)).toMatchObject({
        claimed: 2,
        published: 2,
      });

      await waitFor(
        async () =>
          (await publisher.checkQueue(names.storageQueue)).messageCount === 0 &&
          (await notificationsFor(eventIds)).length === 2,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      const stored = await notificationsFor(eventIds);
      expect(stored).toHaveLength(2);
      expect(
        stored
          .map((row) => row.recipient_id)
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(
        [fixture.clientId, fixture.ownerId].sort((a, b) => a.localeCompare(b)),
      );
      for (const row of stored) expect(row.type).toBe("CONTRACT_ACCEPTED");
      expect((await outboxRows(eventIds)).map((row) => row.status)).toEqual([
        "PUBLISHED",
        "PUBLISHED",
      ]);
      expect(
        (await publisher.checkQueue(names.deadLetterQueue)).messageCount,
      ).toBe(0);
    });
  },
);
