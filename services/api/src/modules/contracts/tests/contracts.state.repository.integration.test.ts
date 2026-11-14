import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../../database/client.js";
import {
  accounts,
  contract_milestones,
  contracts,
  job_posts,
  proposals,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  insertContractIfProposalUnused,
  markContractActiveIfPending,
  markContractCompletedIfActive,
  markMilestoneFundedIfPending,
} from "../contracts.state.repository.js";

const PREFIX = "contracts-state-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
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

const seed = async (
  contractStatus: "PENDING" | "ACTIVE" | "COMPLETED",
  milestoneStatus: "PENDING" | "ACTIVE" | "COMPLETED" = "PENDING",
) => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
  });
  const freelancerId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: freelancerId,
    email: `${freelancerId}@example.test`,
    role: "FREELANCER",
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "State repository job",
      description: "State repository job",
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
      cover_letter: "state repository",
      bid_amount_cents: 1000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: freelancerId,
      title: "State repository contract",
      total_amount_cents: 1000,
      status: contractStatus,
    })
    .returning({ id: contracts.id });
  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: contract!.id,
      title: "Milestone",
      amount_cents: 1000,
      due_date: "2026-01-01",
      position: 0,
      status: milestoneStatus,
    })
    .returning({ id: contract_milestones.id });
  return {
    clientId,
    freelancerId,
    jobId: job!.id,
    proposalId: proposal!.id,
    contractId: contract!.id,
    milestoneId: milestone!.id,
  };
};

const contractStatusOf = async (contractId: string) =>
  (await db.select().from(contracts).where(eq(contracts.id, contractId)))[0]!
    .status;

const milestoneOf = async (milestoneId: string) =>
  (
    await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.id, milestoneId))
  )[0]!;

describe("contracts state repository guards", () => {
  it("activates a contract only while it is PENDING", async () => {
    const active = await seed("ACTIVE");
    expect(
      await markContractActiveIfPending(db, active.contractId, new Date()),
    ).toEqual([]);
    expect(await contractStatusOf(active.contractId)).toBe("ACTIVE");

    const pending = await seed("PENDING");
    expect(
      await markContractActiveIfPending(db, pending.contractId, new Date()),
    ).toHaveLength(1);
    expect(await contractStatusOf(pending.contractId)).toBe("ACTIVE");
  });

  it("completes a contract only while it is ACTIVE", async () => {
    const pending = await seed("PENDING");
    expect(
      await markContractCompletedIfActive(db, pending.contractId, new Date()),
    ).toEqual([]);
    expect(await contractStatusOf(pending.contractId)).toBe("PENDING");

    const active = await seed("ACTIVE");
    expect(
      await markContractCompletedIfActive(db, active.contractId, new Date()),
    ).toHaveLength(1);
    expect(await contractStatusOf(active.contractId)).toBe("COMPLETED");
  });

  it("funds a milestone only while it is PENDING", async () => {
    const funded = await seed("ACTIVE", "ACTIVE");
    const rejected = await markMilestoneFundedIfPending(db, {
      milestoneId: funded.milestoneId,
      checkoutSessionId: "cs_repo_test",
      paymentIntentId: "pi_repo_test",
      now: new Date(),
    });
    expect(rejected).toEqual([]);
    expect((await milestoneOf(funded.milestoneId)).funded_at).toBeNull();

    const pending = await seed("ACTIVE", "PENDING");
    const accepted = await markMilestoneFundedIfPending(db, {
      milestoneId: pending.milestoneId,
      checkoutSessionId: "cs_repo_test",
      paymentIntentId: undefined,
      now: new Date(),
    });
    expect(accepted).toHaveLength(1);
    const row = await milestoneOf(pending.milestoneId);
    expect(row.status).toBe("ACTIVE");
    expect(row.funded_at).not.toBeNull();
  });

  it("answers an empty result, not an error, when the proposal already has a contract", async () => {
    const fixture = await seed("PENDING");
    const second = await insertContractIfProposalUnused(db, {
      proposal_id: fixture.proposalId,
      job_id: fixture.jobId,
      client_id: fixture.clientId,
      freelancer_id: fixture.freelancerId,
      title: "Duplicate",
      total_amount_cents: 1000,
      status: "PENDING",
    });
    expect(second).toEqual([]);
  });
});
