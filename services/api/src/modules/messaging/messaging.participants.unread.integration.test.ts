import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  conversation_participants,
  conversations,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { incrementUnreadCounts } from "./messaging.participants.repository.js";

const PREFIX = "messaging-unread-";
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

const createAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db
    .insert(accounts)
    .values({ auth_id: authId, email: `${authId}@example.test`, role });
  return authId;
};

const seed = async () => {
  const clientId = await createAccount("CLIENT");
  const freelancerId = await createAccount("FREELANCER");
  const ownerId = await createAccount("FREELANCER");
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}agency`,
      size: "1-10",
      specialty: "web",
      overview: "overview",
    })
    .returning({ id: agency_metadata.id });
  const agencyId = agency!.id;

  const makeConversation = async () => {
    const [conversation] = await db
      .insert(conversations)
      .values({ context_key: `${PREFIX}${randomUUID()}` })
      .returning({ id: conversations.id });
    return conversation!.id;
  };
  const conversationId = await makeConversation();
  const otherConversationId = await makeConversation();

  const insertParticipant = async (
    conversation: string,
    values: { account_id?: string; agency_id?: string; type: string },
  ) => {
    const [row] = await db
      .insert(conversation_participants)
      .values({
        conversation_id: conversation,
        account_id: values.account_id,
        agency_id: values.agency_id,
        participant_type: values.type,
        unread_count: 0,
      })
      .returning({ id: conversation_participants.id });
    return row!.id;
  };

  const client = await insertParticipant(conversationId, {
    account_id: clientId,
    type: "CLIENT",
  });
  const freelancer = await insertParticipant(conversationId, {
    account_id: freelancerId,
    type: "FREELANCER",
  });
  const agencyRow = await insertParticipant(conversationId, {
    agency_id: agencyId,
    type: "AGENCY",
  });
  const bystander = await insertParticipant(otherConversationId, {
    account_id: clientId,
    type: "CLIENT",
  });

  const counts = async () => {
    const rows = await db
      .select({
        id: conversation_participants.id,
        unread: conversation_participants.unread_count,
      })
      .from(conversation_participants)
      .where(eq(conversation_participants.conversation_id, conversationId));
    const byId = new Map(rows.map((row) => [row.id, row.unread]));
    return {
      client: byId.get(client),
      freelancer: byId.get(freelancer),
      agency: byId.get(agencyRow),
    };
  };
  const bystanderCount = async () => {
    const [row] = await db
      .select({ unread: conversation_participants.unread_count })
      .from(conversation_participants)
      .where(eq(conversation_participants.id, bystander));
    return row!.unread;
  };

  return {
    conversationId,
    clientId,
    freelancerId,
    agencyId,
    client,
    freelancer,
    agencyRow,
    counts,
    bystanderCount,
  };
};

describe("incrementUnreadCounts targets", () => {
  it("exceptParticipant increments everyone but that participant by the given amount", async () => {
    const s = await seed();
    await incrementUnreadCounts(
      db,
      s.conversationId,
      { exceptParticipant: s.freelancer },
      2,
    );
    expect(await s.counts()).toEqual({ client: 2, freelancer: 0, agency: 2 });
    expect(await s.bystanderCount()).toBe(0);
  });

  it("all increments every participant of the conversation only", async () => {
    const s = await seed();
    await incrementUnreadCounts(db, s.conversationId, { all: true }, 1);
    expect(await s.counts()).toEqual({ client: 1, freelancer: 1, agency: 1 });
    expect(await s.bystanderCount()).toBe(0);
  });

  it("allExceptType skips participants of that type", async () => {
    const s = await seed();
    await incrementUnreadCounts(
      db,
      s.conversationId,
      { allExceptType: "CLIENT" },
      3,
    );
    expect(await s.counts()).toEqual({ client: 0, freelancer: 3, agency: 3 });
    expect(await s.bystanderCount()).toBe(0);
  });

  it("account increments only that account's participant row", async () => {
    const s = await seed();
    await incrementUnreadCounts(
      db,
      s.conversationId,
      { account: s.freelancerId },
      1,
    );
    expect(await s.counts()).toEqual({ client: 0, freelancer: 1, agency: 0 });
  });

  it("account with an agency increments only the agency row", async () => {
    const s = await seed();
    await incrementUnreadCounts(
      db,
      s.conversationId,
      { account: s.freelancerId, agency: s.agencyId },
      1,
    );
    expect(await s.counts()).toEqual({ client: 0, freelancer: 0, agency: 1 });
  });
});
