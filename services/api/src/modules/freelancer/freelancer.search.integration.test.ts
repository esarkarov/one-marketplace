import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  searchFreelancerRows,
  type TalentSearchCriteria,
} from "./freelancer.search.repository.js";
import {
  countHiresPerJob,
  countProposalsPerJob,
  listPublishedJobsWithClient,
} from "./freelancer.jobs.repository.js";

const PREFIX = "freelancer-search-";
const like = `${PREFIX}%`;
const BAND = { minRateCents: 9_000_000, maxRateCents: 9_000_999 };
const EVERYTHING = { limit: 100_000, offset: 0 };

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
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

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    ...extra,
  });
  return authId;
};

type Seed = {
  rate: number;
  verified: boolean;
  status: string;
  earning: { rating: string; success: string; completed: number } | null;
};

const seedTalent = async (seed: Seed) => {
  const authId = await insertAccount("FREELANCER", {
    identityVerified: seed.verified,
  });
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Search developer",
    professional_description: "search description",
    hourly_rate_cents: seed.rate,
    country: "US",
    city: "Austin",
    availability_status: seed.status,
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["TypeScript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  if (seed.earning) {
    await db.insert(freelancer_earning).values({
      freelancer_id: authId,
      rating: seed.earning.rating,
      job_success_score: seed.earning.success,
      completed_jobs: seed.earning.completed,
      review_count: 3,
    });
  }
  return authId;
};

const seedTalentPool = async () => {
  const f1 = await seedTalent({
    rate: 9_000_100,
    verified: true,
    status: "AVAILABLE",
    earning: { rating: "4.50", success: "90.00", completed: 10 },
  });
  const f2 = await seedTalent({
    rate: 9_000_200,
    verified: false,
    status: "AVAILABLE",
    earning: { rating: "3.00", success: "95.00", completed: 30 },
  });
  const f3 = await seedTalent({
    rate: 9_000_300,
    verified: true,
    status: "BUSY",
    earning: { rating: "5.00", success: "60.00", completed: 20 },
  });
  const f4 = await seedTalent({
    rate: 9_000_400,
    verified: true,
    status: "AVAILABLE",
    earning: null,
  });
  const f5 = await seedTalent({
    rate: 9_000_500,
    verified: true,
    status: "AVAILABLE",
    earning: { rating: "2.00", success: "50.00", completed: 15 },
  });
  return { f1, f2, f3, f4, f5 };
};

describe("searchFreelancerRows", () => {
  it("keeps freelancers without an earning row and returns the selected columns", async () => {
    const pool_ = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, sort: "rate-low" },
      EVERYTHING,
    );
    expect(rows.map((row) => row.authId)).toEqual([
      pool_.f1,
      pool_.f2,
      pool_.f3,
      pool_.f4,
      pool_.f5,
    ]);
    expect(rows[0]).toMatchObject({
      authId: pool_.f1,
      professionalTitle: "Search developer",
      professionalDescription: "search description",
      hourlyRateCents: 9_000_100,
      city: "Austin",
      country: "US",
      skills: ["TypeScript"],
      availabilityStatus: "AVAILABLE",
      identityVerified: true,
      rating: "4.50",
      jobSuccessScore: "90.00",
      completedJobs: 10,
      reviewCount: 3,
    });
    expect(rows[3]).toMatchObject({
      authId: pool_.f4,
      rating: null,
      jobSuccessScore: null,
      completedJobs: null,
    });
    expect(rows[2]?.availabilityStatus).toBe("BUSY");
  });

  it.each<
    [
      string,
      TalentSearchCriteria,
      (keyof Awaited<ReturnType<typeof seedTalentPool>>)[],
    ]
  >([
    ["verifiedOnly", { verifiedOnly: true }, ["f1", "f3", "f4", "f5"]],
    ["availableOnly", { availableOnly: true }, ["f1", "f2", "f4", "f5"]],
    ["minRating", { minRating: 4 }, ["f1", "f3"]],
    ["minSuccess", { minSuccess: 80 }, ["f1", "f2"]],
    [
      "minRateCents",
      { minRateCents: 9_000_300, maxRateCents: 9_000_999 },
      ["f3", "f4", "f5"],
    ],
    [
      "maxRateCents",
      { minRateCents: 9_000_000, maxRateCents: 9_000_300 },
      ["f1", "f2", "f3"],
    ],
  ])("filters by %s", async (_name, criteria, expected) => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, ...criteria, sort: "rate-low" },
      EVERYTHING,
    );
    expect(rows.map((row) => row.authId)).toEqual(
      expected.map((key) => talent[key]),
    );
  });

  it.each<
    [
      string,
      TalentSearchCriteria["sort"],
      (keyof Awaited<ReturnType<typeof seedTalentPool>>)[],
    ]
  >([
    ["recommended", "recommended", ["f4", "f1", "f3", "f2", "f5"]],
    ["rating", "rating", ["f4", "f3", "f1", "f2", "f5"]],
    ["success", "success", ["f4", "f2", "f1", "f3", "f5"]],
    ["projects", "projects", ["f4", "f2", "f3", "f5", "f1"]],
    ["rate-low", "rate-low", ["f1", "f2", "f3", "f4", "f5"]],
  ])("sorts by %s", async (_name, sort, expected) => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(db, { ...BAND, sort }, EVERYTHING);
    expect(rows.map((row) => row.authId)).toEqual(
      expected.map((key) => talent[key]),
    );
  });

  it("applies limit and offset to the sorted rows", async () => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, sort: "rate-low" },
      { limit: 2, offset: 1 },
    );
    expect(rows.map((row) => row.authId)).toEqual([talent.f2, talent.f3]);
  });
});

describe("job feed reads", () => {
  const seedClient = async (options: { metadata: boolean; spent: boolean }) => {
    const clientId = await insertAccount("CLIENT", {
      paymentMethodVerified: true,
    });
    if (options.metadata) {
      await db.insert(client_metadata).values({
        auth_id: clientId,
        role: "CLIENT",
        company_name: "Feed Co",
        company_website: "https://feed.example.test",
        company_size: "1-10",
        industry: "Software",
        company_description: "feed client",
      });
    }
    if (options.spent) {
      await db.insert(client_spents).values({
        client_id: clientId,
        total_spent_cents: 5_000,
        review_count: 4,
        rating: "4.50",
      });
    }
    return clientId;
  };

  const insertJob = async (
    clientId: string,
    overrides: Partial<typeof job_posts.$inferInsert>,
  ) => {
    const [job] = await db
      .insert(job_posts)
      .values({
        client_id: clientId,
        title: `${PREFIX}job`,
        description: "feed job",
        expertise_level: "INTERMEDIATE",
        expected_duration: "1 week",
        total_budget_cents: 20_000,
        milestones: [],
        ...overrides,
      })
      .returning({ id: job_posts.id });
    return job!.id;
  };

  it("lists published jobs newest first with their client data", async () => {
    const spentClient = await seedClient({ metadata: true, spent: true });
    const plainClient = await seedClient({ metadata: true, spent: false });
    const noProfileClient = await seedClient({ metadata: false, spent: false });
    const base = Date.now() - 600_000;
    const oldest = await insertJob(spentClient, {
      status: "PUBLISHED",
      published_at: new Date(base),
    });
    const middle = await insertJob(plainClient, {
      status: "PUBLISHED",
      published_at: new Date(base + 1_000),
    });
    const newest = await insertJob(spentClient, {
      status: "PUBLISHED",
      published_at: new Date(base + 2_000),
    });
    const draft = await insertJob(spentClient, {
      status: "DRAFT",
      published_at: new Date(base + 3_000),
    });
    const orphan = await insertJob(noProfileClient, {
      status: "PUBLISHED",
      published_at: new Date(base + 4_000),
    });

    const rows = await listPublishedJobsWithClient(db);
    const mine = rows.filter((row) =>
      [oldest, middle, newest, draft, orphan].includes(row.job.id),
    );
    expect(mine.map((row) => row.job.id)).toEqual([newest, middle, oldest]);
    expect(mine[0]).toMatchObject({
      companyName: "Feed Co",
      paymentVerified: true,
      totalSpentCents: 5_000,
      clientRating: "4.50",
      clientReviewCount: 4,
    });
    expect(mine[1]?.totalSpentCents).toBeNull();
  });

  it("counts proposals per job and only active or completed hires per job", async () => {
    const clientId = await seedClient({ metadata: true, spent: false });
    const hiredJob = await insertJob(clientId, { status: "PUBLISHED" });
    const pendingJob = await insertJob(clientId, { status: "PUBLISHED" });
    const idleJob = await insertJob(clientId, { status: "PUBLISHED" });
    const senders = await Promise.all(
      Array.from({ length: 4 }, () => insertAccount("FREELANCER")),
    );

    const proposalIds: string[] = [];
    for (const sender of senders.slice(0, 3)) {
      const [proposal] = await db
        .insert(proposals)
        .values({
          job_id: hiredJob,
          sender_id: sender,
          sender_type: "FREELANCER",
          cover_letter: "feed proposal",
          bid_amount_cents: 20_000,
          duration: "1 week",
        })
        .returning({ id: proposals.id });
      proposalIds.push(proposal!.id);
    }
    const [pendingProposal] = await db
      .insert(proposals)
      .values({
        job_id: pendingJob,
        sender_id: senders[3]!,
        sender_type: "FREELANCER",
        cover_letter: "feed proposal",
        bid_amount_cents: 20_000,
        duration: "1 week",
      })
      .returning({ id: proposals.id });

    const contractFor = (
      proposalId: string,
      jobId: string,
      freelancerId: string,
      status: "PENDING" | "ACTIVE" | "COMPLETED",
    ) =>
      db.insert(contracts).values({
        proposal_id: proposalId,
        job_id: jobId,
        client_id: clientId,
        freelancer_id: freelancerId,
        title: `${PREFIX}contract`,
        total_amount_cents: 20_000,
        status,
      });
    await contractFor(proposalIds[0]!, hiredJob, senders[0]!, "ACTIVE");
    await contractFor(proposalIds[1]!, hiredJob, senders[1]!, "COMPLETED");
    await contractFor(proposalIds[2]!, hiredJob, senders[2]!, "PENDING");
    await contractFor(pendingProposal!.id, pendingJob, senders[3]!, "PENDING");

    const proposalCounts = await countProposalsPerJob(db);
    const countOf = <T extends { jobId: string; count: number }>(
      rows: T[],
      jobId: string,
    ) => rows.find((row) => row.jobId === jobId)?.count;
    expect(countOf(proposalCounts, hiredJob)).toBe(3);
    expect(countOf(proposalCounts, pendingJob)).toBe(1);
    expect(countOf(proposalCounts, idleJob)).toBeUndefined();

    const hireCounts = await countHiresPerJob(db);
    expect(countOf(hireCounts, hiredJob)).toBe(2);
    expect(countOf(hireCounts, pendingJob)).toBeUndefined();
  });
});
