import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import { accounts, job_posts, proposals } from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { markProposalHired } from "@/modules/proposals/repositories/proposals.repository.js";

const PREFIX = "proposals-hired-guard-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

beforeEach(async () => {
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

const insertProposal = async (status: string) => {
  const clientId = `${PREFIX}${randomUUID()}`;
  const senderId = `${PREFIX}${randomUUID()}`;
  for (const [authId, role] of [
    [clientId, "CLIENT"],
    [senderId, "FREELANCER"],
  ] as const) {
    await db.insert(accounts).values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role,
    });
  }
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Proposal guard job",
      description: "guard",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 100,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: senderId,
      sender_type: "FREELANCER",
      cover_letter: "guard",
      bid_amount_cents: 100,
      duration: "1 week",
      status,
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const statusOf = async (proposalId: string) =>
  (await db.select().from(proposals).where(eq(proposals.id, proposalId)))[0]!
    .status;

describe("markProposalHired", () => {
  it("hires an INTERVIEWED proposal once", async () => {
    const proposalId = await insertProposal("INTERVIEWED");

    expect(await markProposalHired(db, proposalId)).toEqual({ id: proposalId });
    expect(await statusOf(proposalId)).toBe("HIRED");
    expect(await markProposalHired(db, proposalId)).toBeUndefined();
  });

  it.each(["SUBMITTED", "VIEWED"])(
    "does not change a %s proposal",
    async (status) => {
      const proposalId = await insertProposal(status);

      expect(await markProposalHired(db, proposalId)).toBeUndefined();
      expect(await statusOf(proposalId)).toBe(status);
    },
  );
});
