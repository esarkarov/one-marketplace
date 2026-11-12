import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  setEx: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: { setEx: mocks.setEx },
}));

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: vi.fn() } },
}));

vi.mock("../../infrastructure/events/publisher.js", () => ({
  sendNotification: mocks.sendNotification,
}));

vi.mock("../messaging/messaging.socket.js", () => ({
  emitConversationUpdate: vi.fn(),
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  connects,
  connects_history,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { submitAgencyProposal, submitProposal } from "./proposals.service.js";

const PREFIX = "self-deal-it-";
const STARTING_CONNECTS = 100;

const purgeLeftovers = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const countLeftovers = async () => {
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
       (select count(*) from freelancer_metadata where auth_id like $1) +
       (select count(*) from job_posts where client_id like $1)
     )::text as total`,
    [`${PREFIX}%`],
  );
  return Number(result.rows[0]?.total ?? 0);
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

const createFreelancer = async () => {
  const authId = await createAccount("FREELANCER");
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Engineer",
    professional_description: "Integration freelancer",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30",
    experience_level: "INTERMEDIATE",
    languages: [],
  });
  const [balance] = await db
    .insert(connects)
    .values({ freelancer_id: authId, connects: STARTING_CONNECTS })
    .returning({ id: connects.id });
  return { authId, connectsId: balance!.id };
};

const createAgency = async () => {
  const ownerId = await createAccount("FREELANCER");
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}agency-${randomUUID()}`,
      size: "1-10",
      specialty: "testing",
      overview: "integration test agency",
    })
    .returning({ id: agency_metadata.id });
  const [balance] = await db
    .insert(connects)
    .values({ agency_id: agency!.id, connects: STARTING_CONNECTS })
    .returning({ id: connects.id });
  return { ownerId, agencyId: agency!.id, connectsId: balance!.id };
};

const createJob = async (clientId: string) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Integration job",
      description: "Integration test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 10000,
      milestones: [],
      status: "PUBLISHED",
    })
    .returning({ id: job_posts.id });
  return job!.id;
};

const input = (jobId: string) => ({
  jobId,
  coverLetter: "I can do this",
  bidAmountCents: 9000,
  duration: "1 week",
  screeningAnswers: [],
});

const proposalsForJob = (jobId: string) =>
  db.select().from(proposals).where(eq(proposals.job_id, jobId));

const balanceOf = async (connectsId: string) => {
  const [row] = await db
    .select({ connects: connects.connects })
    .from(connects)
    .where(eq(connects.id, connectsId));
  return row!.connects;
};

const historyCount = async (connectsId: string) =>
  (
    await db
      .select()
      .from(connects_history)
      .where(eq(connects_history.connects_id, connectsId))
  ).length;

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purgeLeftovers();
});

afterAll(async () => {
  await purgeLeftovers();
  const leftovers = await countLeftovers();
  await pool.end();
  expect(leftovers).toBe(0);
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.setEx.mockReset();
  mocks.setEx.mockResolvedValue(undefined);
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue(undefined);
});

describe("proposal self-dealing", () => {
  it("rejects a freelancer bidding on their own job without a row or Connects charge", async () => {
    const { authId, connectsId } = await createFreelancer();
    const jobId = await createJob(authId);

    await expect(submitProposal(authId, input(jobId))).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(await proposalsForJob(jobId)).toHaveLength(0);
    expect(await balanceOf(connectsId)).toBe(STARTING_CONNECTS);
    expect(await historyCount(connectsId)).toBe(0);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("rejects an agency owner bidding through the agency on their own job", async () => {
    const { ownerId, agencyId, connectsId } = await createAgency();
    const jobId = await createJob(ownerId);

    await expect(
      submitAgencyProposal(agencyId, input(jobId)),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(await proposalsForJob(jobId)).toHaveLength(0);
    expect(await balanceOf(connectsId)).toBe(STARTING_CONNECTS);
    expect(await historyCount(connectsId)).toBe(0);
  });

  it("still accepts a normal freelancer bid", async () => {
    const { authId, connectsId } = await createFreelancer();
    const clientId = await createAccount("CLIENT");
    const jobId = await createJob(clientId);

    const result = await submitProposal(authId, input(jobId));

    expect(result.proposal.sender_id).toBe(authId);
    expect(await proposalsForJob(jobId)).toHaveLength(1);
    expect(await balanceOf(connectsId)).toBeLessThan(STARTING_CONNECTS);
    expect(await historyCount(connectsId)).toBe(1);
  });

  it("still accepts a normal agency bid", async () => {
    const { agencyId } = await createAgency();
    const clientId = await createAccount("CLIENT");
    const jobId = await createJob(clientId);

    await submitAgencyProposal(agencyId, input(jobId));

    expect(await proposalsForJob(jobId)).toHaveLength(1);
  });
});
