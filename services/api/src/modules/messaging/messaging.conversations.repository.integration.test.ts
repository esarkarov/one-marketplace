import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  meetings,
  message_attachments,
  messages,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  appendConversationMessages,
  findAccountRole,
  findActiveMeetingForConversation,
  findJobOwnedByClient,
  findProposalWithJobClient,
  insertOrFindConversationByContextKey,
  listActiveMeetingsForConversations,
  listConversationRowsOfParticipant,
  setConversationLastMessage,
} from "./messaging.conversations.repository.js";

const PREFIX = "messaging-conversations-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
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

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
  });
  return authId;
};

const insertConversation = async (
  values: Partial<typeof conversations.$inferInsert> = {},
) => {
  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: newAuthId(), ...values })
    .returning({ id: conversations.id });
  return conversation!.id;
};

const insertJobAndProposal = async (clientId: string, freelancerId: string) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: `${PREFIX}job`,
      description: "conversation repository job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 20000,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: freelancerId,
      sender_type: "FREELANCER",
      cover_letter: "conversation repository proposal",
      bid_amount_cents: 20000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  return { jobId: job!.id, proposalId: proposal!.id };
};

const insertMeeting = async (
  conversationId: string,
  startedBy: string,
  status: "ACTIVE" | "ENDED",
) => {
  const [meeting] = await db
    .insert(meetings)
    .values({
      conversation_id: conversationId,
      provider_room_name: `room-${randomUUID()}`,
      join_url: `https://daily.test/${randomUUID()}`,
      started_by_account_id: startedBy,
      status,
    })
    .returning({ id: meetings.id });
  return meeting!.id;
};

describe("listConversationRowsOfParticipant", () => {
  it("returns only the participant's conversations, newest activity first, with joined data", async () => {
    const clientId = await insertAccount("CLIENT");
    const otherClientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const { jobId, proposalId } = await insertJobAndProposal(
      clientId,
      freelancerId,
    );
    await db.insert(contracts).values({
      proposal_id: proposalId,
      job_id: jobId,
      client_id: clientId,
      freelancer_id: freelancerId,
      title: `${PREFIX}contract`,
      total_amount_cents: 20000,
      status: "ACTIVE",
    });

    const base = Date.now() - 600_000;
    const withMessages = await insertConversation({
      job_id: jobId,
      proposal_id: proposalId,
      created_at: new Date(base),
    });
    const older = await insertConversation({ created_at: new Date(base + 1) });
    const nullEarly = await insertConversation({
      created_at: new Date(base + 2),
    });
    const nullLate = await insertConversation({
      created_at: new Date(base + 3),
    });
    const foreign = await insertConversation({ created_at: new Date(base) });

    const [first] = await db
      .insert(messages)
      .values({
        conversation_id: withMessages,
        sender_id: clientId,
        body: "newest message",
        created_at: new Date(base + 10_000),
      })
      .returning({ id: messages.id });
    const [skipped] = await db
      .insert(messages)
      .values({
        conversation_id: older,
        sender_id: clientId,
        body: "older message",
        created_at: new Date(base + 5_000),
      })
      .returning({ id: messages.id });
    await db.insert(message_attachments).values({
      message_id: first!.id,
      storage_key: `file_${randomUUID()}`,
      file_url: "https://example.test/brief.pdf",
      file_name: "brief.pdf",
      mime_type: "application/pdf",
      file_size: 10,
      attachment_type: "FILE",
    });
    await db
      .update(conversations)
      .set({
        last_message_id: first!.id,
        last_message_at: new Date(base + 10_000),
      })
      .where(eq(conversations.id, withMessages));
    await db
      .update(conversations)
      .set({
        last_message_id: skipped!.id,
        last_message_at: new Date(base + 5_000),
      })
      .where(eq(conversations.id, older));

    await db.insert(conversation_participants).values([
      {
        conversation_id: withMessages,
        account_id: freelancerId,
        participant_type: "FREELANCER",
        unread_count: 3,
      },
      {
        conversation_id: older,
        account_id: freelancerId,
        participant_type: "FREELANCER",
        unread_count: 1,
      },
      {
        conversation_id: nullEarly,
        account_id: freelancerId,
        participant_type: "FREELANCER",
      },
      {
        conversation_id: nullLate,
        account_id: freelancerId,
        participant_type: "FREELANCER",
      },
      {
        conversation_id: withMessages,
        account_id: clientId,
        participant_type: "CLIENT",
        unread_count: 9,
      },
      {
        conversation_id: foreign,
        account_id: otherClientId,
        participant_type: "CLIENT",
      },
    ]);

    const rows = await listConversationRowsOfParticipant(db, {
      agencyId: null,
      userId: freelancerId,
    });
    expect(rows.map((row) => row.id)).toEqual([
      nullLate,
      nullEarly,
      withMessages,
      older,
    ]);

    const full = rows.find((row) => row.id === withMessages)!;
    expect(full.unreadCount).toBe(3);
    expect(full.jobId).toBe(jobId);
    expect(full.proposalId).toBe(proposalId);
    expect(full.jobTitle).toBe(`${PREFIX}job`);
    expect(full.contractStatus).toBe("ACTIVE");
    expect(full.contractId).not.toBeNull();
    expect(full.lastMessage?.id).toBe(first!.id);
    expect(full.lastMessage?.body).toBe("newest message");
    expect(full.lastMessage?.senderId).toBe(clientId);
    expect(full.lastAttachmentName).toBe("brief.pdf");

    const bare = rows.find((row) => row.id === older)!;
    expect(bare.jobId).toBeNull();
    expect(bare.jobTitle).toBeNull();
    expect(bare.contractId).toBeNull();
    expect(bare.contractStatus).toBeNull();
    expect(bare.lastAttachmentName).toBeNull();
    expect(bare.lastMessage?.id).toBe(skipped!.id);
    expect(bare.unreadCount).toBe(1);

    const clientRows = await listConversationRowsOfParticipant(db, {
      agencyId: null,
      userId: clientId,
    });
    expect(clientRows.map((row) => row.id)).toEqual([withMessages]);
    expect(clientRows[0]?.unreadCount).toBe(9);
  });

  it("scopes an agency participant to the agency's conversations only", async () => {
    const ownerId = await insertAccount("FREELANCER");
    const otherOwnerId = await insertAccount("FREELANCER");
    const clientId = await insertAccount("CLIENT");
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "agency",
      })
      .returning({ id: agency_metadata.id });
    const [otherAgency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: otherOwnerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "other agency",
      })
      .returning({ id: agency_metadata.id });

    const agencyConversation = await insertConversation();
    const ownerAccountConversation = await insertConversation();
    const otherAgencyConversation = await insertConversation();
    await db.insert(conversation_participants).values([
      {
        conversation_id: agencyConversation,
        agency_id: agency!.id,
        participant_type: "AGENCY",
      },
      {
        conversation_id: agencyConversation,
        account_id: clientId,
        participant_type: "CLIENT",
      },
      {
        conversation_id: ownerAccountConversation,
        account_id: ownerId,
        participant_type: "FREELANCER",
      },
      {
        conversation_id: otherAgencyConversation,
        agency_id: otherAgency!.id,
        participant_type: "AGENCY",
      },
    ]);

    const rows = await listConversationRowsOfParticipant(db, {
      agencyId: agency!.id,
      userId: ownerId,
    });
    expect(rows.map((row) => row.id)).toEqual([agencyConversation]);
  });
});

describe("meeting lookups", () => {
  it("lists only ACTIVE meetings of the requested conversations", async () => {
    const accountId = await insertAccount("CLIENT");
    const listed = await insertConversation();
    const endedOnly = await insertConversation();
    const notRequested = await insertConversation();
    const activeId = await insertMeeting(listed, accountId, "ACTIVE");
    await insertMeeting(endedOnly, accountId, "ENDED");
    await insertMeeting(notRequested, accountId, "ACTIVE");

    const rows = await listActiveMeetingsForConversations(db, [
      listed,
      endedOnly,
    ]);
    expect(rows.map((row) => row.id)).toEqual([activeId]);
    expect(rows[0]?.conversationId).toBe(listed);
    expect(rows[0]?.startedByAccountId).toBe(accountId);
  });

  it("finds an active meeting of one conversation and ignores ended ones", async () => {
    const accountId = await insertAccount("CLIENT");
    const withActive = await insertConversation();
    const withEnded = await insertConversation();
    const empty = await insertConversation();
    const activeId = await insertMeeting(withActive, accountId, "ACTIVE");
    await insertMeeting(withEnded, accountId, "ENDED");

    expect(await findActiveMeetingForConversation(db, withActive)).toEqual({
      id: activeId,
    });
    expect(await findActiveMeetingForConversation(db, withEnded)).toBe(
      undefined,
    );
    expect(await findActiveMeetingForConversation(db, empty)).toBe(undefined);
  });
});

describe("proposal, role and job lookups", () => {
  it("finds a proposal with the client of its job", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const first = await insertJobAndProposal(clientId, freelancerId);
    const otherClientId = await insertAccount("CLIENT");
    const second = await insertJobAndProposal(otherClientId, freelancerId);

    expect(await findProposalWithJobClient(db, second.proposalId)).toEqual({
      freelancerId,
      senderType: "FREELANCER",
      jobId: second.jobId,
      clientId: otherClientId,
    });
    expect(await findProposalWithJobClient(db, first.proposalId)).toEqual({
      freelancerId,
      senderType: "FREELANCER",
      jobId: first.jobId,
      clientId,
    });
    expect(await findProposalWithJobClient(db, randomUUID())).toBe(undefined);
  });

  it("finds the role of one account", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    expect(await findAccountRole(db, freelancerId)).toEqual({
      role: "FREELANCER",
    });
    expect(await findAccountRole(db, clientId)).toEqual({ role: "CLIENT" });
    expect(await findAccountRole(db, newAuthId())).toBe(undefined);
  });

  it("finds a job only for the client that owns it", async () => {
    const clientId = await insertAccount("CLIENT");
    const otherClientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const own = await insertJobAndProposal(clientId, freelancerId);
    const another = await insertJobAndProposal(clientId, freelancerId);
    const foreign = await insertJobAndProposal(otherClientId, freelancerId);

    expect(await findJobOwnedByClient(db, own.jobId, clientId)).toEqual({
      id: own.jobId,
    });
    expect(await findJobOwnedByClient(db, another.jobId, clientId)).toEqual({
      id: another.jobId,
    });
    expect(await findJobOwnedByClient(db, foreign.jobId, clientId)).toBe(
      undefined,
    );
    expect(await findJobOwnedByClient(db, own.jobId, otherClientId)).toBe(
      undefined,
    );
  });
});

describe("insertOrFindConversationByContextKey", () => {
  it("creates once, stores the context and returns the existing row on conflict", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const { jobId, proposalId } = await insertJobAndProposal(
      clientId,
      freelancerId,
    );
    const key = newAuthId();
    const otherKey = newAuthId();

    const created = await insertOrFindConversationByContextKey(db, {
      jobId,
      proposalId,
      contextKey: key,
    });
    const other = await insertOrFindConversationByContextKey(db, {
      jobId: undefined,
      proposalId: undefined,
      contextKey: otherKey,
    });
    expect(other.id).not.toBe(created.id);

    const [stored] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, created.id));
    expect(stored?.context_key).toBe(key);
    expect(stored?.job_id).toBe(jobId);
    expect(stored?.proposal_id).toBe(proposalId);

    const again = await insertOrFindConversationByContextKey(db, {
      jobId: undefined,
      proposalId: undefined,
      contextKey: key,
    });
    expect(again.id).toBe(created.id);
    const second = await insertOrFindConversationByContextKey(db, {
      jobId: undefined,
      proposalId: undefined,
      contextKey: otherKey,
    });
    expect(second.id).toBe(other.id);
  });
});

describe("setConversationLastMessage and appendConversationMessages", () => {
  it("updates only the addressed conversation", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const { proposalId } = await insertJobAndProposal(clientId, freelancerId);
    const target = await insertConversation();
    const untouched = await insertConversation();
    const [message] = await db
      .insert(messages)
      .values({ conversation_id: target, sender_id: clientId, body: "hi" })
      .returning({ id: messages.id });
    const messageAt = new Date(Date.now() - 120_000);
    const updatedAt = new Date(Date.now() - 60_000);

    await setConversationLastMessage(db, {
      conversationId: target,
      messageId: message!.id,
      messageAt,
      updatedAt,
    });
    const [first] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, target));
    expect(first?.last_message_id).toBe(message!.id);
    expect(first?.last_message_at?.getTime()).toBe(messageAt.getTime());
    expect(first?.updated_at.getTime()).toBe(updatedAt.getTime());
    expect(first?.proposal_id).toBeNull();

    await setConversationLastMessage(db, {
      conversationId: target,
      messageId: message!.id,
      messageAt,
      updatedAt,
      proposalId,
    });
    const [second] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, target));
    expect(second?.proposal_id).toBe(proposalId);

    const [other] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, untouched));
    expect(other?.last_message_id).toBeNull();
    expect(other?.last_message_at).toBeNull();
    expect(other?.proposal_id).toBeNull();
  });

  it("points the conversation at the last inserted message and counts every message as unread", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const conversationId = await insertConversation();
    const [clientSide, freelancerSide] = await db
      .insert(conversation_participants)
      .values([
        {
          conversation_id: conversationId,
          account_id: clientId,
          participant_type: "CLIENT",
        },
        {
          conversation_id: conversationId,
          account_id: freelancerId,
          participant_type: "FREELANCER",
        },
      ])
      .returning({ id: conversation_participants.id });

    const rows = await appendConversationMessages(db, {
      conversationId,
      messages: [
        { sender_id: clientId, body: "one" },
        { sender_id: clientId, body: "two" },
        { sender_id: clientId, body: "three" },
      ],
      updatedAt: new Date(),
      unread: { account: freelancerId },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.body)).toEqual(["one", "two", "three"]);

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(conversation?.last_message_id).toBe(rows[2]!.id);

    const participants = await db
      .select()
      .from(conversation_participants)
      .where(eq(conversation_participants.conversation_id, conversationId));
    const unreadOf = (id: string) =>
      participants.find((participant) => participant.id === id)?.unread_count;
    expect(unreadOf(freelancerSide!.id)).toBe(3);
    expect(unreadOf(clientSide!.id)).toBe(0);
  });
});
