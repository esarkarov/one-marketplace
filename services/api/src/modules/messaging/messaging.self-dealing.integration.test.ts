import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: {
    users: { getUser: vi.fn().mockRejectedValue(new Error("clerk down")) },
  },
}));

vi.mock("./messaging.socket.js", () => ({
  emitConversationUpdate: vi.fn(),
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  job_posts,
  proposals,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { createConversation } from "./messaging.service.js";

const PREFIX = "msg-self-it-";

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query(
    "delete from conversations where proposal_id in (select id from proposals where sender_id like $1 or job_id in (select id from job_posts where client_id like $1))",
    [like],
  );
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const createAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const createJob = async (clientId: string) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Self dealing job",
      description: "integration",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 10000,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  return job!.id;
};

const createProposal = async (
  jobId: string,
  senderId: string,
  senderType: "FREELANCER" | "AGENCY",
) => {
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: senderId,
      sender_type: senderType,
      cover_letter: "integration",
      bid_amount_cents: 10000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const conversationCount = async (proposalId: string) => {
  const result = await pool.query(
    "select id from conversations where proposal_id = $1",
    [proposalId],
  );
  return result.rowCount;
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

describe("createConversation via proposalId", () => {
  it("opens a conversation for a proposal on the caller's own job", async () => {
    const client = await createAccount("CLIENT");
    const freelancer = await createAccount("FREELANCER");
    const jobId = await createJob(client);
    const proposalId = await createProposal(jobId, freelancer, "FREELANCER");

    await createConversation(client, { proposalId });

    expect(await conversationCount(proposalId)).toBe(1);
  });

  it("rejects a freelancer proposal when the caller is also the job's client", async () => {
    const user = await createAccount("CLIENT");
    const jobId = await createJob(user);
    const proposalId = await createProposal(jobId, user, "FREELANCER");

    await expect(
      createConversation(user, { proposalId }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await conversationCount(proposalId)).toBe(0);
  });

  it("rejects an agency proposal when the caller is on the agency team and the job's client", async () => {
    const user = await createAccount("FREELANCER");
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: user,
        name: `${PREFIX}agency`,
        size: "1-10",
        specialty: "testing",
        overview: "integration",
      })
      .returning({ id: agency_metadata.id });
    const jobId = await createJob(user);
    const proposalId = await createProposal(jobId, agency!.id, "AGENCY");

    await expect(
      createConversation(user, { proposalId }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await conversationCount(proposalId)).toBe(0);
  });
});
