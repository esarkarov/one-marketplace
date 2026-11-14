import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  conversation_participants,
  conversations,
  messages,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  markParticipantReadIfNotAhead,
  markReadIfMessageInConversation,
} from "./messaging.participants.repository.js";

const PREFIX = "messaging-participants-repo-";
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

const seed = async () => {
  const userId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: userId,
    email: `${userId}@example.test`,
    role: "CLIENT",
  });
  const makeConversation = async () => {
    const [conversation] = await db
      .insert(conversations)
      .values({ context_key: `${PREFIX}${randomUUID()}` })
      .returning({ id: conversations.id });
    return conversation!.id;
  };
  const conversationId = await makeConversation();
  const otherConversationId = await makeConversation();
  const [participant] = await db
    .insert(conversation_participants)
    .values({
      conversation_id: conversationId,
      account_id: userId,
      participant_type: "CLIENT",
      unread_count: 5,
    })
    .returning({ id: conversation_participants.id });

  const base = Date.now();
  const insertMessage = async (conversation: string, offset: number) => {
    const [message] = await db
      .insert(messages)
      .values({
        conversation_id: conversation,
        sender_id: userId,
        body: "hello",
        created_at: new Date(base + offset),
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    return message!;
  };
  return {
    userId,
    conversationId,
    participantId: participant!.id,
    older: await insertMessage(conversationId, 0),
    newer: await insertMessage(conversationId, 1000),
    foreign: await insertMessage(otherConversationId, 2000),
  };
};

const stateOf = async (participantId: string) =>
  (
    await db
      .select()
      .from(conversation_participants)
      .where(eq(conversation_participants.id, participantId))
  )[0]!;

describe("messaging participants repository guards", () => {
  it("never moves the read marker backwards", async () => {
    const fixture = await seed();
    const advanced = await markParticipantReadIfNotAhead(db, {
      participantId: fixture.participantId,
      message: fixture.newer,
      unreadCount: 0,
    });
    expect(advanced).toEqual({ unreadCount: 0 });

    const stale = await markParticipantReadIfNotAhead(db, {
      participantId: fixture.participantId,
      message: fixture.older,
      unreadCount: 7,
    });
    expect(stale).toBeUndefined();
    const state = await stateOf(fixture.participantId);
    expect(state.last_read_message_id).toBe(fixture.newer.id);
    expect(state.unread_count).toBe(0);
  });

  it("marks read through a socket only for a message of the same conversation", async () => {
    const fixture = await seed();
    const foreign = await markReadIfMessageInConversation(db, {
      conversationId: fixture.conversationId,
      messageId: fixture.foreign.id,
      agencyId: null,
      userId: fixture.userId,
    });
    expect(foreign).toBeUndefined();
    expect((await stateOf(fixture.participantId)).unread_count).toBe(5);

    const own = await markReadIfMessageInConversation(db, {
      conversationId: fixture.conversationId,
      messageId: fixture.newer.id,
      agencyId: null,
      userId: fixture.userId,
    });
    expect(own).toEqual({ id: fixture.participantId });
    expect((await stateOf(fixture.participantId)).unread_count).toBe(0);
  });
});
