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
import { listConversationIdsOfParticipant } from "./messaging.participants.repository.js";

const PREFIX = "messaging-scope-";
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

const createAgency = async (ownerId: string) => {
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
  return agency!.id;
};

type Side = { accountId: string } | { agencyId: string };

const createConversation = async (sides: Side[]) => {
  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: `${PREFIX}${randomUUID()}` })
    .returning({ id: conversations.id });
  const id = conversation!.id;
  await db.insert(conversation_participants).values(
    sides.map((side) =>
      "agencyId" in side
        ? {
            conversation_id: id,
            agency_id: side.agencyId,
            participant_type: "AGENCY",
          }
        : {
            conversation_id: id,
            account_id: side.accountId,
            participant_type: "CLIENT",
          },
    ),
  );
  return id;
};

const headScopeQuery = async (
  userId: string,
  scope: "default" | "agency",
  agencyId: string | null,
) => {
  const rows = await db
    .select({ conversationId: conversation_participants.conversation_id })
    .from(conversation_participants)
    .where(
      scope === "agency" && agencyId
        ? eq(conversation_participants.agency_id, agencyId)
        : eq(conversation_participants.account_id, userId),
    );
  return rows.map(({ conversationId }) => conversationId).sort();
};

const currentScopeQuery = async (
  userId: string,
  scope: "default" | "agency",
  agencyId: string | null,
) => {
  const rows = await listConversationIdsOfParticipant(
    db,
    scope === "agency" && agencyId ? { agencyId } : { accountId: userId },
  );
  return rows.map(({ conversationId }) => conversationId).sort();
};

const seed = async () => {
  const client = await createAccount("CLIENT");
  const freelancer = await createAccount("FREELANCER");
  const agencyOwner = await createAccount("FREELANCER");
  const member = await createAccount("FREELANCER");
  const agency = await createAgency(agencyOwner);

  const otherClient = await createAccount("CLIENT");
  const otherFreelancer = await createAccount("FREELANCER");
  const otherAgencyOwner = await createAccount("FREELANCER");
  const otherAgency = await createAgency(otherAgencyOwner);

  const direct = await createConversation([
    { accountId: client },
    { accountId: freelancer },
  ]);
  const withAgency = await createConversation([
    { accountId: client },
    { agencyId: agency },
  ]);
  const withMember = await createConversation([
    { accountId: client },
    { accountId: member },
  ]);
  const otherDirect = await createConversation([
    { accountId: otherClient },
    { accountId: otherFreelancer },
  ]);
  const otherWithAgency = await createConversation([
    { accountId: otherClient },
    { agencyId: otherAgency },
  ]);

  return {
    client,
    freelancer,
    member,
    agency,
    otherClient,
    otherFreelancer,
    otherAgency,
    direct,
    withAgency,
    withMember,
    otherDirect,
    otherWithAgency,
  };
};

describe("listConversationIdsOfParticipant scopes", () => {
  it("returns exactly the participant's conversations for each scope and none of another tenant's", async () => {
    const s = await seed();

    const cases: {
      name: string;
      userId: string;
      scope: "default" | "agency";
      agencyId: string | null;
      expected: string[];
    }[] = [
      {
        name: "freelancer",
        userId: s.freelancer,
        scope: "default",
        agencyId: null,
        expected: [s.direct],
      },
      {
        name: "client",
        userId: s.client,
        scope: "default",
        agencyId: null,
        expected: [s.direct, s.withAgency, s.withMember],
      },
      {
        name: "agency member",
        userId: s.member,
        scope: "agency",
        agencyId: s.agency,
        expected: [s.withAgency],
      },
      {
        name: "agency member in default scope",
        userId: s.member,
        scope: "default",
        agencyId: s.agency,
        expected: [s.withMember],
      },
      {
        name: "agency scope without an agency id",
        userId: s.member,
        scope: "agency",
        agencyId: null,
        expected: [s.withMember],
      },
      {
        name: "other client",
        userId: s.otherClient,
        scope: "default",
        agencyId: null,
        expected: [s.otherDirect, s.otherWithAgency],
      },
      {
        name: "other freelancer",
        userId: s.otherFreelancer,
        scope: "default",
        agencyId: null,
        expected: [s.otherDirect],
      },
      {
        name: "other agency",
        userId: s.otherAgency,
        scope: "agency",
        agencyId: s.otherAgency,
        expected: [s.otherWithAgency],
      },
    ];

    for (const { name, userId, scope, agencyId, expected } of cases) {
      const current = await currentScopeQuery(userId, scope, agencyId);
      const head = await headScopeQuery(userId, scope, agencyId);
      expect(current, name).toEqual([...expected].sort());
      expect(current, `${name} matches the HEAD scope conditions`).toEqual(
        head,
      );
    }

    const mine = new Set([s.direct, s.withAgency, s.withMember]);
    const others = [s.otherDirect, s.otherWithAgency];
    for (const userId of [s.freelancer, s.client, s.member]) {
      const ids = await currentScopeQuery(userId, "default", null);
      expect(ids.some((id) => others.includes(id))).toBe(false);
      expect(ids.every((id) => mine.has(id))).toBe(true);
    }
    const agencyIds = await currentScopeQuery(s.member, "agency", s.agency);
    expect(agencyIds.some((id) => others.includes(id))).toBe(false);
  });
});
