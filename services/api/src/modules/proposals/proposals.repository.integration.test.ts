import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import { accounts, job_posts, proposals } from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { markProposalViewedIfSubmitted } from "./proposals.repository.js";

const PREFIX = "proposals-repo-";
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

afterAll(async () => {
  await purge();
  await pool.end();
});

const seedProposal = async (status: "SUBMITTED" | "INTERVIEWED") => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Proposal repository job",
      description: "Proposal repository job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 1000,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: `${PREFIX}${randomUUID()}`,
      sender_type: "FREELANCER",
      cover_letter: "proposal repository",
      bid_amount_cents: 1000,
      duration: "1 week",
      status,
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const statusOf = async (proposalId: string) =>
  (await db.select().from(proposals).where(eq(proposals.id, proposalId)))[0]!
    .status;

describe("proposals repository guards", () => {
  it("marks a proposal viewed only while it is SUBMITTED", async () => {
    const interviewed = await seedProposal("INTERVIEWED");
    expect(
      await markProposalViewedIfSubmitted(db, interviewed),
    ).toBeUndefined();
    expect(await statusOf(interviewed)).toBe("INTERVIEWED");

    const submitted = await seedProposal("SUBMITTED");
    expect(await markProposalViewedIfSubmitted(db, submitted)).toBeDefined();
    expect(await statusOf(submitted)).toBe("VIEWED");
  });
});
