import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  conversations,
  messages,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  countMessagesFromOthersAfter,
  findMessageInConversation,
  insertMessageAttachments,
  insertMessages,
  listAttachmentsForMessages,
  listMessagesPage,
  listReplyPreviews,
} from "./messaging.messages.repository.js";

const PREFIX = "messaging-messages-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

const insertAccount = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "CLIENT",
  });
  return authId;
};

const insertConversation = async () => {
  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: `${PREFIX}${randomUUID()}` })
    .returning({ id: conversations.id });
  return conversation!.id;
};

const attachment = (messageId: string, name: string) => ({
  message_id: messageId,
  storage_key: `file_${randomUUID()}`,
  file_url: `https://example.test/${name}`,
  file_name: name,
  mime_type: "application/pdf",
  file_size: 10,
  attachment_type: "FILE",
});

const seedTimeline = async () => {
  const senderId = await insertAccount();
  const conversationId = await insertConversation();
  const otherConversationId = await insertConversation();
  const base = Date.now() - 600_000;
  const at = (offset: number) => new Date(base + offset);

  const [oldest] = await db
    .insert(messages)
    .values({
      conversation_id: conversationId,
      sender_id: senderId,
      body: "oldest",
      created_at: at(0),
    })
    .returning();
  const [reply] = await db
    .insert(messages)
    .values({
      conversation_id: conversationId,
      sender_id: senderId,
      body: "reply",
      reply_to_message_id: oldest!.id,
      created_at: at(1000),
    })
    .returning();
  const tied = await db
    .insert(messages)
    .values([
      {
        conversation_id: conversationId,
        sender_id: senderId,
        body: "tie-a",
        created_at: at(2000),
      },
      {
        conversation_id: conversationId,
        sender_id: senderId,
        body: "tie-b",
        created_at: at(2000),
      },
    ])
    .returning();
  const [lowTie, highTie] = [...tied].sort((a, b) =>
    a.id < b.id ? -1 : 1,
  ) as [(typeof tied)[number], (typeof tied)[number]];
  const [event] = await db
    .insert(messages)
    .values({
      conversation_id: conversationId,
      sender_id: senderId,
      message_type: "SYSTEM_EVENT",
      event_type: "CONTRACT_OFFER",
      event_payload: { amountCents: 500 },
      created_at: at(3000),
    })
    .returning();
  await db.insert(messages).values({
    conversation_id: otherConversationId,
    sender_id: senderId,
    body: "elsewhere",
    created_at: at(4000),
  });
  return {
    senderId,
    conversationId,
    oldest: oldest!,
    reply: reply!,
    lowTie,
    highTie,
    event: event!,
  };
};

describe("insertMessages and insertMessageAttachments", () => {
  it("inserts every message and every attachment row", async () => {
    const senderId = await insertAccount();
    const conversationId = await insertConversation();
    const rows = await insertMessages(db, conversationId, [
      { sender_id: senderId, body: "a" },
      { sender_id: senderId, body: "b" },
      { sender_id: senderId, body: "c" },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.conversation_id === conversationId)).toBe(
      true,
    );

    await insertMessageAttachments(db, [
      attachment(rows[0]!.id, "one.pdf"),
      attachment(rows[0]!.id, "two.pdf"),
      attachment(rows[1]!.id, "three.pdf"),
    ]);
    const stored = await listAttachmentsForMessages(db, [
      rows[0]!.id,
      rows[1]!.id,
    ]);
    expect(stored.map((row) => row.file_name).sort()).toEqual([
      "one.pdf",
      "three.pdf",
      "two.pdf",
    ]);
  });
});

describe("listMessagesPage", () => {
  it("orders newest first with id as tie-breaker and honours the limit", async () => {
    const fixture = await seedTimeline();
    const all = await listMessagesPage(db, {
      conversationId: fixture.conversationId,
      before: null,
      limit: 50,
    });
    expect(all.map((row) => row.id)).toEqual([
      fixture.event.id,
      fixture.highTie.id,
      fixture.lowTie.id,
      fixture.reply.id,
      fixture.oldest.id,
    ]);

    const limited = await listMessagesPage(db, {
      conversationId: fixture.conversationId,
      before: null,
      limit: 2,
    });
    expect(limited.map((row) => row.id)).toEqual([
      fixture.event.id,
      fixture.highTie.id,
    ]);

    const event = all[0]!;
    expect(event.eventType).toBe("CONTRACT_OFFER");
    expect(event.eventPayload).toEqual({ amountCents: 500 });
    expect(event.conversationId).toBe(fixture.conversationId);
    const reply = all.find((row) => row.id === fixture.reply.id)!;
    expect(reply.replyToMessageId).toBe(fixture.oldest.id);
    expect(reply.body).toBe("reply");
    expect(reply.senderId).toBe(fixture.senderId);
  });

  it("pages strictly before a cursor, including messages that share its timestamp", async () => {
    const fixture = await seedTimeline();
    const page = (before: { createdAt: Date; id: string }) =>
      listMessagesPage(db, {
        conversationId: fixture.conversationId,
        before,
        limit: 50,
      }).then((rows) => rows.map((row) => row.id));

    expect(
      await page({
        createdAt: fixture.highTie.created_at,
        id: fixture.highTie.id,
      }),
    ).toEqual([fixture.lowTie.id, fixture.reply.id, fixture.oldest.id]);
    expect(
      await page({
        createdAt: fixture.lowTie.created_at,
        id: fixture.lowTie.id,
      }),
    ).toEqual([fixture.reply.id, fixture.oldest.id]);
    expect(
      await page({
        createdAt: fixture.reply.created_at,
        id: fixture.reply.id,
      }),
    ).toEqual([fixture.oldest.id]);
    expect(
      await page({
        createdAt: fixture.oldest.created_at,
        id: fixture.oldest.id,
      }),
    ).toEqual([]);
  });
});

describe("attachment and reply lookups", () => {
  it("lists attachments only for the requested messages", async () => {
    const fixture = await seedTimeline();
    await insertMessageAttachments(db, [
      attachment(fixture.oldest.id, "mine.pdf"),
      attachment(fixture.reply.id, "other.pdf"),
    ]);
    const rows = await listAttachmentsForMessages(db, [fixture.oldest.id]);
    expect(rows.map((row) => row.file_name)).toEqual(["mine.pdf"]);
    expect(await listAttachmentsForMessages(db, [fixture.highTie.id])).toEqual(
      [],
    );
  });

  it("returns reply previews only for the requested messages", async () => {
    const fixture = await seedTimeline();
    const rows = await listReplyPreviews(db, [fixture.oldest.id]);
    expect(rows).toEqual([
      {
        id: fixture.oldest.id,
        senderId: fixture.senderId,
        messageType: "USER",
        body: "oldest",
        eventType: null,
      },
    ]);
    const previews = await listReplyPreviews(db, [
      fixture.event.id,
      fixture.reply.id,
    ]);
    expect(previews).toHaveLength(2);
    expect(previews.find((row) => row.id === fixture.event.id)).toEqual({
      id: fixture.event.id,
      senderId: fixture.senderId,
      messageType: "SYSTEM_EVENT",
      body: null,
      eventType: "CONTRACT_OFFER",
    });
  });
});

describe("findMessageInConversation", () => {
  it("finds a message only inside its own conversation", async () => {
    const fixture = await seedTimeline();
    const found = await findMessageInConversation(
      db,
      fixture.reply.id,
      fixture.conversationId,
    );
    expect(found?.id).toBe(fixture.reply.id);
    expect(found?.createdAt.getTime()).toBe(fixture.reply.created_at.getTime());

    const otherConversation = await insertConversation();
    expect(
      await findMessageInConversation(db, fixture.reply.id, otherConversation),
    ).toBe(undefined);
    expect(
      await findMessageInConversation(db, randomUUID(), fixture.conversationId),
    ).toBe(undefined);
  });
});

describe("countMessagesFromOthersAfter", () => {
  it("counts later messages of other senders in the same conversation", async () => {
    const authorId = await insertAccount();
    const otherId = await insertAccount();
    const conversationId = await insertConversation();
    const elsewhere = await insertConversation();
    const base = Date.now() - 600_000;
    const at = (offset: number) => new Date(base + offset);

    await db.insert(messages).values({
      conversation_id: conversationId,
      sender_id: otherId,
      body: "before",
      created_at: at(0),
    });
    const tied = await db
      .insert(messages)
      .values([
        {
          conversation_id: conversationId,
          sender_id: otherId,
          body: "tie-a",
          created_at: at(1000),
        },
        {
          conversation_id: conversationId,
          sender_id: otherId,
          body: "tie-b",
          created_at: at(1000),
        },
      ])
      .returning();
    const [lowTie, highTie] = [...tied].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    ) as [(typeof tied)[number], (typeof tied)[number]];
    await db.insert(messages).values([
      {
        conversation_id: conversationId,
        sender_id: otherId,
        body: "later",
        created_at: at(2000),
      },
      {
        conversation_id: conversationId,
        sender_id: authorId,
        body: "own later",
        created_at: at(3000),
      },
      {
        conversation_id: elsewhere,
        sender_id: otherId,
        body: "other conversation",
        created_at: at(4000),
      },
    ]);

    const count = async (after: { id: string; createdAt: Date }) =>
      (
        await countMessagesFromOthersAfter(db, {
          conversationId,
          excludedSenderIds: [authorId],
          after,
        })
      )?.value;

    expect(await count({ id: lowTie.id, createdAt: lowTie.created_at })).toBe(
      2,
    );
    expect(await count({ id: highTie.id, createdAt: highTie.created_at })).toBe(
      1,
    );
    expect(await count({ id: randomUUID(), createdAt: at(1500) })).toBe(1);
    expect(
      await count({
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        createdAt: at(2000),
      }),
    ).toBe(0);
  });
});
