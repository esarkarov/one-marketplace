import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  client_metadata,
  conversation_participants,
  conversations,
  freelancer_metadata,
  messages,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  findParticipantByAccount,
  findParticipantByAgency,
  findParticipantReadState,
  insertConversationParticipantsIfAbsent,
  listParticipantProfileRows,
  listParticipantsOfConversations,
  markParticipantReadIfNotAhead,
  markReadIfMessageInConversation,
  resetClientReadState,
} from "./messaging.participants.repository.js";

const PREFIX = "messaging-participants-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
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

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
  });
  return authId;
};

const insertAgency = async (ownerId: string, name: string) => {
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name,
      size: "1-10",
      specialty: "testing",
      overview: "participants agency",
      avatar_image: { imageId: "img", url: "https://example.test/a.png" },
    })
    .returning({ id: agency_metadata.id });
  return agency!.id;
};

const insertConversation = async () => {
  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: `${PREFIX}${randomUUID()}` })
    .returning({ id: conversations.id });
  return conversation!.id;
};

const rowsOf = (conversationId: string) =>
  db
    .select()
    .from(conversation_participants)
    .where(eq(conversation_participants.conversation_id, conversationId));

describe("participant lookups", () => {
  it("finds the participant of one account inside one conversation", async () => {
    const first = await insertAccount("CLIENT");
    const second = await insertAccount("FREELANCER");
    const conversationId = await insertConversation();
    const otherConversationId = await insertConversation();
    const inserted = await db
      .insert(conversation_participants)
      .values([
        {
          conversation_id: otherConversationId,
          account_id: second,
          participant_type: "FREELANCER",
        },
        {
          conversation_id: conversationId,
          account_id: first,
          participant_type: "CLIENT",
        },
        {
          conversation_id: conversationId,
          account_id: second,
          participant_type: "FREELANCER",
        },
      ])
      .returning({ id: conversation_participants.id });

    expect(
      (await findParticipantByAccount(db, conversationId, second))?.id,
    ).toBe(inserted[2]!.id);
    expect(
      (await findParticipantByAccount(db, conversationId, first))?.id,
    ).toBe(inserted[1]!.id);
    expect(
      (await findParticipantByAccount(db, otherConversationId, second))?.id,
    ).toBe(inserted[0]!.id);
    expect(await findParticipantByAccount(db, otherConversationId, first)).toBe(
      undefined,
    );
  });

  it("finds the participant of one agency inside one conversation", async () => {
    const ownerA = await insertAccount("FREELANCER");
    const ownerB = await insertAccount("FREELANCER");
    const agencyA = await insertAgency(ownerA, `${PREFIX}agency-a`);
    const agencyB = await insertAgency(ownerB, `${PREFIX}agency-b`);
    const conversationId = await insertConversation();
    const otherConversationId = await insertConversation();
    const inserted = await db
      .insert(conversation_participants)
      .values([
        {
          conversation_id: otherConversationId,
          agency_id: agencyB,
          participant_type: "AGENCY",
        },
        {
          conversation_id: conversationId,
          agency_id: agencyA,
          participant_type: "AGENCY",
        },
        {
          conversation_id: conversationId,
          agency_id: agencyB,
          participant_type: "AGENCY",
        },
      ])
      .returning({ id: conversation_participants.id });

    expect(
      (await findParticipantByAgency(db, conversationId, agencyB))?.id,
    ).toBe(inserted[2]!.id);
    expect(
      (await findParticipantByAgency(db, conversationId, agencyA))?.id,
    ).toBe(inserted[1]!.id);
    expect(
      (await findParticipantByAgency(db, otherConversationId, agencyB))?.id,
    ).toBe(inserted[0]!.id);
    expect(
      await findParticipantByAgency(db, otherConversationId, agencyA),
    ).toBe(undefined);
  });

  it("lists participants of the requested conversations with their profile data", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const ownerId = await insertAccount("FREELANCER");
    const agencyId = await insertAgency(ownerId, `${PREFIX}profile-agency`);
    await db.insert(client_metadata).values({
      auth_id: clientId,
      role: "CLIENT",
      company_name: "Profile Co",
      company_website: "https://profile.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "participant profile client",
    });
    await db.insert(freelancer_metadata).values({
      auth_id: freelancerId,
      professional_title: "Profile developer",
      professional_description: "participant profile freelancer",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30+ hours",
      experience_level: "INTERMEDIATE",
      skills: ["TypeScript"],
      languages: [{ language: "English", proficiency: "Fluent" }],
    });
    const requested = await insertConversation();
    const skipped = await insertConversation();
    await db.insert(conversation_participants).values([
      {
        conversation_id: requested,
        account_id: clientId,
        participant_type: "CLIENT",
      },
      {
        conversation_id: requested,
        account_id: freelancerId,
        participant_type: "FREELANCER",
      },
      {
        conversation_id: requested,
        agency_id: agencyId,
        participant_type: "AGENCY",
      },
      {
        conversation_id: skipped,
        account_id: clientId,
        participant_type: "CLIENT",
      },
    ]);

    const profiles = await listParticipantProfileRows(db, [requested]);
    expect(profiles).toHaveLength(3);
    const byType = (type: string) =>
      profiles.find((row) => row.participantType === type)!;
    expect(byType("CLIENT")).toMatchObject({
      conversationId: requested,
      accountId: clientId,
      agencyId: null,
      companyName: "Profile Co",
      professionalTitle: null,
      agencyName: null,
    });
    expect(byType("FREELANCER")).toMatchObject({
      accountId: freelancerId,
      professionalTitle: "Profile developer",
      companyName: null,
      agencyName: null,
    });
    expect(byType("AGENCY")).toMatchObject({
      accountId: null,
      agencyId,
      agencyName: `${PREFIX}profile-agency`,
      agencyAvatar: { imageId: "img", url: "https://example.test/a.png" },
      professionalTitle: null,
      companyName: null,
    });

    const plain = await listParticipantsOfConversations(db, [requested]);
    expect(plain).toHaveLength(3);
    expect(plain.find((row) => row.participantType === "AGENCY")).toEqual({
      accountId: null,
      agencyId,
      participantType: "AGENCY",
    });
    expect(plain.find((row) => row.participantType === "CLIENT")).toEqual({
      accountId: clientId,
      agencyId: null,
      participantType: "CLIENT",
    });
    expect(await listParticipantsOfConversations(db, [skipped])).toHaveLength(
      1,
    );
  });
});

describe("insertConversationParticipantsIfAbsent", () => {
  it("creates one client and one counterparty row and tolerates a repeat", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const ownerId = await insertAccount("FREELANCER");
    const agencyId = await insertAgency(ownerId, `${PREFIX}insert-agency`);
    const direct = await insertConversation();
    const viaAgency = await insertConversation();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await insertConversationParticipantsIfAbsent(db, {
        conversationId: direct,
        clientId,
        counterparty: { accountId: freelancerId },
      });
      await insertConversationParticipantsIfAbsent(db, {
        conversationId: viaAgency,
        clientId,
        counterparty: { agencyId },
      });
    }

    const describeRow = (row: typeof conversation_participants.$inferSelect) =>
      `${row.participant_type}:${row.account_id ?? row.agency_id}`;
    expect((await rowsOf(direct)).map(describeRow).sort()).toEqual(
      [`CLIENT:${clientId}`, `FREELANCER:${freelancerId}`].sort(),
    );
    expect((await rowsOf(viaAgency)).map(describeRow).sort()).toEqual(
      [`AGENCY:${agencyId}`, `CLIENT:${clientId}`].sort(),
    );
  });
});

describe("read state writes", () => {
  it("resets only the client's own participant in the given conversation", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const conversationId = await insertConversation();
    const otherConversationId = await insertConversation();
    const [message] = await db
      .insert(messages)
      .values({ conversation_id: conversationId, sender_id: freelancerId })
      .returning({ id: messages.id });
    const inserted = await db
      .insert(conversation_participants)
      .values([
        {
          conversation_id: conversationId,
          account_id: clientId,
          participant_type: "CLIENT",
          unread_count: 5,
        },
        {
          conversation_id: conversationId,
          account_id: freelancerId,
          participant_type: "FREELANCER",
          unread_count: 4,
        },
        {
          conversation_id: otherConversationId,
          account_id: clientId,
          participant_type: "CLIENT",
          unread_count: 6,
        },
      ])
      .returning({ id: conversation_participants.id });

    await resetClientReadState(db, {
      conversationId,
      clientId,
      lastReadMessageId: message!.id,
    });

    const target = await stateOf(inserted[0]!.id);
    expect(target.unread_count).toBe(0);
    expect(target.last_read_message_id).toBe(message!.id);
    expect(target.last_read_at).not.toBeNull();
    const sibling = await stateOf(inserted[1]!.id);
    expect(sibling.unread_count).toBe(4);
    expect(sibling.last_read_message_id).toBeNull();
    const elsewhere = await stateOf(inserted[2]!.id);
    expect(elsewhere.unread_count).toBe(6);
    expect(elsewhere.last_read_message_id).toBeNull();
  });

  it("stores the supplied unread count, refuses a repeat of the same message and reads the state back", async () => {
    const fixture = await seed();
    const other = await seed();

    const first = await markParticipantReadIfNotAhead(db, {
      participantId: fixture.participantId,
      message: fixture.newer,
      unreadCount: 3,
    });
    expect(first).toEqual({ unreadCount: 3 });
    expect(
      await markParticipantReadIfNotAhead(db, {
        participantId: fixture.participantId,
        message: fixture.newer,
        unreadCount: 1,
      }),
    ).toBeUndefined();

    expect(await findParticipantReadState(db, fixture.participantId)).toEqual({
      lastReadMessageId: fixture.newer.id,
      unreadCount: 3,
    });
    expect(await findParticipantReadState(db, other.participantId)).toEqual({
      lastReadMessageId: null,
      unreadCount: 5,
    });
    expect(await findParticipantReadState(db, randomUUID())).toBeUndefined();
  });

  it("marks a socket read only for the matching participant, scope and conversation", async () => {
    const fixture = await seed();
    const ownerId = await insertAccount("FREELANCER");
    const agencyId = await insertAgency(ownerId, `${PREFIX}socket-agency`);
    const stranger = await insertAccount("CLIENT");
    const elsewhere = await insertConversation();
    const inserted = await db
      .insert(conversation_participants)
      .values([
        {
          conversation_id: fixture.conversationId,
          agency_id: agencyId,
          participant_type: "AGENCY",
          unread_count: 8,
        },
        {
          conversation_id: fixture.conversationId,
          account_id: stranger,
          participant_type: "CLIENT",
          unread_count: 7,
        },
        {
          conversation_id: elsewhere,
          account_id: fixture.userId,
          participant_type: "CLIENT",
          unread_count: 6,
        },
      ])
      .returning({ id: conversation_participants.id });

    const viaAgency = await markReadIfMessageInConversation(db, {
      conversationId: fixture.conversationId,
      messageId: fixture.newer.id,
      agencyId,
      userId: ownerId,
    });
    expect(viaAgency).toEqual({ id: inserted[0]!.id });
    const agencyState = await stateOf(inserted[0]!.id);
    expect(agencyState.unread_count).toBe(0);
    expect(agencyState.last_read_message_id).toBe(fixture.newer.id);
    expect((await stateOf(fixture.participantId)).unread_count).toBe(5);

    const viaAccount = await markReadIfMessageInConversation(db, {
      conversationId: fixture.conversationId,
      messageId: fixture.newer.id,
      agencyId: null,
      userId: fixture.userId,
    });
    expect(viaAccount).toEqual({ id: fixture.participantId });
    const accountState = await stateOf(fixture.participantId);
    expect(accountState.last_read_message_id).toBe(fixture.newer.id);
    expect(accountState.last_read_at).not.toBeNull();
    expect((await stateOf(inserted[1]!.id)).unread_count).toBe(7);
    expect((await stateOf(inserted[2]!.id)).unread_count).toBe(6);
  });
});
