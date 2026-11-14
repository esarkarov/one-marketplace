import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_members,
  agency_metadata,
  client_metadata,
  client_spents,
  contract_milestones,
  contracts,
  earning_history,
  freelancer_earning,
  freelancer_metadata,
  freelancer_portfolios,
  job_posts,
  payout_history,
  proposals,
  reviews,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  deletePortfoliosOfFreelancer,
  findAgencyIdentityOfMember,
  findEarningStats,
  findFreelancerAuthIdByProfileId,
  findFreelancerLocation,
  findFreelancerSkills,
  findFreelancerWithAccount,
  insertPortfolios,
  listActiveOrCompletedContractsOfFreelancer,
  listPortfoliosOfFreelancer,
  listReviewsOfContract,
  listStoredPortfolioCoverImages,
  upsertFreelancerMetadata,
} from "./freelancer.repository.js";
import {
  findCertificateAccount,
  findHasEarnings,
  findPayoutAccount,
  listEarningAmounts,
  listEarningsWithPayoutState,
  listMonthlyEarningTotals,
} from "./freelancer.earnings.repository.js";
import {
  countHiresForJob,
  countProposalsForJob,
  findPublishedJobDetail,
} from "./freelancer.jobs.repository.js";
import { getAgencyIdentityForMember } from "./freelancer.agency-identity.js";

const PREFIX = "freelancer-repo-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
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

const metadataValues = (
  overrides: Partial<typeof freelancer_metadata.$inferInsert> = {},
) => ({
  professional_title: "Backend developer",
  professional_description: "Repository test freelancer",
  hourly_rate_cents: 5000,
  country: "US",
  city: "Austin",
  weekly_availability: "30+ hours",
  experience_level: "INTERMEDIATE",
  skills: ["TypeScript"],
  languages: [{ language: "English", proficiency: "Fluent" }],
  ...overrides,
});

const insertFreelancer = async (
  overrides: Partial<typeof freelancer_metadata.$inferInsert> = {},
  accountExtra: Partial<typeof accounts.$inferInsert> = {},
) => {
  const authId = await insertAccount("FREELANCER", accountExtra);
  const [profile] = await db
    .insert(freelancer_metadata)
    .values({ auth_id: authId, ...metadataValues(overrides) })
    .returning({ id: freelancer_metadata.id });
  return { authId, profileId: profile!.id };
};

const insertClient = async (withMetadata = true) => {
  const authId = await insertAccount("CLIENT");
  if (withMetadata) {
    await db.insert(client_metadata).values({
      auth_id: authId,
      role: "CLIENT",
      company_name: `Company ${authId.slice(-6)}`,
      company_website: "https://company.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: `About ${authId.slice(-6)}`,
    });
  }
  return authId;
};

const insertJob = async (
  clientId: string,
  overrides: Partial<typeof job_posts.$inferInsert> = {},
) => {
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: `${PREFIX}job`,
      description: "repository job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 20000,
      milestones: [],
      status: "PUBLISHED",
      published_at: new Date(),
      ...overrides,
    })
    .returning();
  return job!;
};

const insertProposal = async (jobId: string, senderId: string) => {
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: senderId,
      sender_type: "FREELANCER",
      cover_letter: "repository proposal",
      bid_amount_cents: 20000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const insertContract = async (input: {
  jobId: string;
  clientId: string;
  freelancerId: string;
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  updatedAt?: Date;
  title?: string;
}) => {
  const proposalId = await insertProposal(input.jobId, input.freelancerId);
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposalId,
      job_id: input.jobId,
      client_id: input.clientId,
      freelancer_id: input.freelancerId,
      title: input.title ?? `${PREFIX}contract`,
      total_amount_cents: 20000,
      status: input.status,
      ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
    })
    .returning();
  return contract!;
};

const insertEarning = async (input: {
  contractId: string;
  freelancerId: string;
  amountCents: number;
  feeCents: number;
  createdAt: Date;
  payout?: "PAID" | "PENDING";
}) => {
  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: input.contractId,
      title: "milestone",
      amount_cents: input.amountCents,
      due_date: "2030-01-01",
      position: 1,
    })
    .returning({ id: contract_milestones.id });
  const [earning] = await db
    .insert(earning_history)
    .values({
      freelancer_id: input.freelancerId,
      contract_id: input.contractId,
      milestone_id: milestone!.id,
      amount_cents: input.amountCents,
      platform_fee_cents: input.feeCents,
      description: "earning",
      created_at: input.createdAt,
    })
    .returning({ id: earning_history.id });
  if (input.payout) {
    await db.insert(payout_history).values({
      freelancer_id: input.freelancerId,
      earning_history_id: earning!.id,
      amount_cents: input.amountCents - input.feeCents,
      status: input.payout,
    });
  }
  return earning!.id;
};

const insertPortfolio = async (profileId: string, title: string) => {
  const [row] = await db
    .insert(freelancer_portfolios)
    .values({
      freelancer_id: profileId,
      title,
      category: "Web",
      description: `${title} description`,
      cover_image: { imageId: `img-${title}`, url: `https://x.test/${title}` },
    })
    .returning({ id: freelancer_portfolios.id });
  return row!.id;
};

describe("profile reads", () => {
  it("finds the profile with its account only for a FREELANCER account of that user", async () => {
    const first = await insertFreelancer({ city: "Austin" });
    const second = await insertFreelancer({ city: "Berlin" });
    const clientWithProfile = await insertAccount("CLIENT");
    await db
      .insert(freelancer_metadata)
      .values({ auth_id: clientWithProfile, ...metadataValues() });

    const found = await findFreelancerWithAccount(db, second.authId);
    expect(found?.freelancer_metadata.auth_id).toBe(second.authId);
    expect(found?.freelancer_metadata.city).toBe("Berlin");
    expect(found?.accounts.role).toBe("FREELANCER");
    expect(
      (await findFreelancerWithAccount(db, first.authId))?.freelancer_metadata
        .city,
    ).toBe("Austin");
    expect(await findFreelancerWithAccount(db, clientWithProfile)).toBe(
      undefined,
    );
    expect(await findFreelancerWithAccount(db, newAuthId())).toBe(undefined);
  });

  it("reads skills, location and the auth id of exactly one profile", async () => {
    const first = await insertFreelancer({
      skills: ["Go"],
      country: "DE",
      city: "Berlin",
    });
    const second = await insertFreelancer({
      skills: ["Rust"],
      country: "FR",
      city: "Paris",
    });

    expect(await findFreelancerSkills(db, second.authId)).toEqual({
      skills: ["Rust"],
    });
    expect(await findFreelancerSkills(db, first.authId)).toEqual({
      skills: ["Go"],
    });
    expect(await findFreelancerLocation(db, second.authId)).toEqual({
      country: "FR",
      city: "Paris",
    });
    expect(await findFreelancerLocation(db, first.authId)).toEqual({
      country: "DE",
      city: "Berlin",
    });
    expect(await findFreelancerLocation(db, newAuthId())).toBe(undefined);
    expect(await findFreelancerAuthIdByProfileId(db, second.profileId)).toEqual(
      { userId: second.authId },
    );
    expect(await findFreelancerAuthIdByProfileId(db, first.profileId)).toEqual({
      userId: first.authId,
    });
    expect(await findFreelancerAuthIdByProfileId(db, randomUUID())).toBe(
      undefined,
    );
  });

  it("reads the earning statistics of one freelancer", async () => {
    const first = await insertFreelancer();
    const second = await insertFreelancer();
    await db.insert(freelancer_earning).values([
      {
        freelancer_id: first.authId,
        total_earning_cents: 1000,
        completed_jobs: 1,
        ongoing_jobs: 2,
        review_count: 3,
        job_success_score: "81.50",
        rating: "4.25",
      },
      {
        freelancer_id: second.authId,
        total_earning_cents: 9000,
        completed_jobs: 7,
        ongoing_jobs: 6,
        review_count: 5,
        job_success_score: "99.00",
        rating: "3.10",
      },
    ]);

    expect(await findEarningStats(db, second.authId)).toEqual({
      totalEarningCents: 9000,
      completedJobs: 7,
      ongoingJobs: 6,
      reviewCount: 5,
      jobSuccessScore: "99.00",
      rating: "3.10",
    });
    expect(await findEarningStats(db, first.authId)).toEqual({
      totalEarningCents: 1000,
      completedJobs: 1,
      ongoingJobs: 2,
      reviewCount: 3,
      jobSuccessScore: "81.50",
      rating: "4.25",
    });
    expect(await findEarningStats(db, newAuthId())).toBe(undefined);
  });
});

describe("portfolio writes and reads", () => {
  it("lists, replaces and deletes only the portfolios of one profile", async () => {
    const first = await insertFreelancer();
    const second = await insertFreelancer();
    await insertPortfolio(first.profileId, "first-a");
    await insertPortfolio(first.profileId, "first-b");
    await insertPortfolio(second.profileId, "second-a");

    const firstRows = await listPortfoliosOfFreelancer(db, first.profileId);
    expect(firstRows.map((row) => row.title).sort()).toEqual([
      "first-a",
      "first-b",
    ]);
    const covers = await listStoredPortfolioCoverImages(db, first.authId);
    expect(covers.map((row) => row.cover_image.imageId).sort()).toEqual([
      "img-first-a",
      "img-first-b",
    ]);
    expect(
      (await listStoredPortfolioCoverImages(db, second.authId)).map(
        (row) => row.cover_image.imageId,
      ),
    ).toEqual(["img-second-a"]);

    await deletePortfoliosOfFreelancer(db, first.profileId);
    expect(await listPortfoliosOfFreelancer(db, first.profileId)).toEqual([]);
    expect(await listPortfoliosOfFreelancer(db, second.profileId)).toHaveLength(
      1,
    );

    const inserted = await insertPortfolios(db, [
      {
        freelancer_id: first.profileId,
        title: "new-a",
        category: "Web",
        description: "d",
        cover_image: { imageId: "n1", url: "https://x.test/n1" },
      },
      {
        freelancer_id: first.profileId,
        title: "new-b",
        category: "Web",
        description: "d",
        cover_image: { imageId: "n2", url: "https://x.test/n2" },
      },
    ]);
    expect(inserted.map((row) => row.title).sort()).toEqual(["new-a", "new-b"]);
    expect(await listPortfoliosOfFreelancer(db, first.profileId)).toHaveLength(
      2,
    );
  });
});

describe("upsertFreelancerMetadata", () => {
  it("creates the profile once and updates the same row afterwards", async () => {
    const authId = await insertAccount("FREELANCER");
    const other = await insertFreelancer({ city: "Oslo" });

    const created = await upsertFreelancerMetadata(
      db,
      authId,
      metadataValues({ city: "Rome", hourly_rate_cents: 7000 }),
    );
    expect(created?.auth_id).toBe(authId);
    expect(created?.city).toBe("Rome");

    const updated = await upsertFreelancerMetadata(
      db,
      authId,
      metadataValues({ city: "Madrid", hourly_rate_cents: 8000 }),
    );
    expect(updated?.id).toBe(created?.id);
    expect(updated?.city).toBe("Madrid");
    expect(updated?.hourly_rate_cents).toBe(8000);

    const [stored] = await db
      .select()
      .from(freelancer_metadata)
      .where(eq(freelancer_metadata.auth_id, authId));
    expect(stored?.city).toBe("Madrid");
    const [untouched] = await db
      .select()
      .from(freelancer_metadata)
      .where(eq(freelancer_metadata.auth_id, other.authId));
    expect(untouched?.city).toBe("Oslo");
  });
});

describe("contracts and reviews of a freelancer", () => {
  it("lists active and completed contracts of one freelancer, newest update first", async () => {
    const clientId = await insertClient();
    const clientWithoutProfile = await insertClient(false);
    const freelancer = await insertFreelancer();
    const other = await insertFreelancer();
    const job = await insertJob(clientId, { skills: ["Go", "SQL"] });
    const base = Date.now() - 600_000;

    const older = await insertContract({
      jobId: job.id,
      clientId,
      freelancerId: freelancer.authId,
      status: "COMPLETED",
      updatedAt: new Date(base),
    });
    const newer = await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: freelancer.authId,
      status: "ACTIVE",
      updatedAt: new Date(base + 10_000),
    });
    await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: freelancer.authId,
      status: "PENDING",
    });
    await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: other.authId,
      status: "ACTIVE",
    });
    await insertContract({
      jobId: (await insertJob(clientWithoutProfile)).id,
      clientId: clientWithoutProfile,
      freelancerId: freelancer.authId,
      status: "ACTIVE",
    });

    const rows = await listActiveOrCompletedContractsOfFreelancer(
      db,
      freelancer.authId,
    );
    expect(rows.map((row) => row.contract.id)).toEqual([newer.id, older.id]);
    expect(rows[1]?.skills).toEqual(["Go", "SQL"]);
    expect(rows[1]?.companyName).toMatch(/^Company /);
  });

  it("lists the reviews of one contract only", async () => {
    const clientId = await insertClient();
    const freelancer = await insertFreelancer();
    const first = await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: freelancer.authId,
      status: "COMPLETED",
    });
    const second = await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: freelancer.authId,
      status: "COMPLETED",
    });
    await db.insert(reviews).values([
      {
        contract_id: first.id,
        reviewer_id: clientId,
        reviewee_id: freelancer.authId,
        rating: 5,
        comment: "first review",
      },
      {
        contract_id: second.id,
        reviewer_id: clientId,
        reviewee_id: freelancer.authId,
        rating: 2,
        comment: "second review",
      },
    ]);

    const rows = await listReviewsOfContract(db, first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reviewerId: clientId,
      revieweeId: freelancer.authId,
      rating: 5,
      comment: "first review",
    });
  });
});

describe("agency identity", () => {
  it("resolves the agency a freelancer belongs to", async () => {
    const ownerA = await insertAccount("FREELANCER");
    const ownerB = await insertAccount("FREELANCER");
    const memberA = await insertAccount("FREELANCER");
    const memberB = await insertAccount("FREELANCER");
    const loner = await insertAccount("FREELANCER");
    const [agencyA] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerA,
        name: `${PREFIX}agency-a`,
        size: "1-10",
        specialty: "testing",
        overview: "a",
        professional_title: "Title A",
        avatar_image: { imageId: "a", url: "https://x.test/a.png" },
      })
      .returning({ id: agency_metadata.id });
    const [agencyB] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerB,
        name: `${PREFIX}agency-b`,
        size: "1-10",
        specialty: "testing",
        overview: "b",
        professional_title: "Title B",
      })
      .returning({ id: agency_metadata.id });
    await db.insert(agency_members).values([
      { agency_id: agencyA!.id, freelancer_id: memberA, role: "Agency member" },
      { agency_id: agencyB!.id, freelancer_id: memberB, role: "Agency member" },
    ]);

    expect(await findAgencyIdentityOfMember(db, memberB)).toEqual({
      id: agencyB!.id,
      name: `${PREFIX}agency-b`,
      avatarImage: null,
    });
    expect(await findAgencyIdentityOfMember(db, memberA)).toEqual({
      id: agencyA!.id,
      name: `${PREFIX}agency-a`,
      avatarImage: { imageId: "a", url: "https://x.test/a.png" },
    });
    expect(await findAgencyIdentityOfMember(db, loner)).toBe(undefined);

    expect(await getAgencyIdentityForMember(memberA)).toEqual({
      id: agencyA!.id,
      name: `${PREFIX}agency-a`,
      avatarUrl: "https://x.test/a.png",
    });
    expect(await getAgencyIdentityForMember(memberB)).toEqual({
      id: agencyB!.id,
      name: `${PREFIX}agency-b`,
      avatarUrl: null,
    });
    expect(await getAgencyIdentityForMember(loner)).toBeNull();
  });
});

describe("earnings reads", () => {
  const seedEarner = async () => {
    const clientId = await insertClient();
    const freelancer = await insertFreelancer();
    const contract = await insertContract({
      jobId: (await insertJob(clientId)).id,
      clientId,
      freelancerId: freelancer.authId,
      status: "ACTIVE",
      title: `${PREFIX}earner-contract`,
    });
    return { clientId, freelancer, contract };
  };

  it("tells whether a freelancer has any earning", async () => {
    const earner = await seedEarner();
    const idle = await insertFreelancer();
    await insertEarning({
      contractId: earner.contract.id,
      freelancerId: earner.freelancer.authId,
      amountCents: 1000,
      feeCents: 100,
      createdAt: new Date(),
    });
    expect(await findHasEarnings(db, earner.freelancer.authId)).toEqual({
      hasEarnings: true,
    });
    expect(await findHasEarnings(db, idle.authId)).toEqual({
      hasEarnings: false,
    });
  });

  it("totals net earnings per month inside the span, oldest month first", async () => {
    const earner = await seedEarner();
    const rival = await seedEarner();
    const earn = (
      who: typeof earner,
      amountCents: number,
      feeCents: number,
      createdAt: string,
    ) =>
      insertEarning({
        contractId: who.contract.id,
        freelancerId: who.freelancer.authId,
        amountCents,
        feeCents,
        createdAt: new Date(createdAt),
      });
    await earn(earner, 10_000, 1_000, "2025-02-10T12:00:00Z");
    await earn(earner, 5_000, 500, "2025-01-15T12:00:00Z");
    await earn(earner, 2_000, 200, "2025-02-20T12:00:00Z");
    await earn(earner, 7_000, 700, "2024-12-15T12:00:00Z");
    await earn(rival, 90_000, 9_000, "2025-01-16T12:00:00Z");

    const rows = await listMonthlyEarningTotals(
      db,
      earner.freelancer.authId,
      new Date("2025-01-01T00:00:00Z"),
    );
    expect(rows).toEqual([
      { month: "2025-01", totalCents: "4500" },
      { month: "2025-02", totalCents: "10800" },
    ]);
  });

  it("lists every earning of one freelancer with its payout state, newest first", async () => {
    const earner = await seedEarner();
    const rival = await seedEarner();
    const clientWithoutProfile = await insertClient(false);
    const noProfileContract = await insertContract({
      jobId: (await insertJob(clientWithoutProfile)).id,
      clientId: clientWithoutProfile,
      freelancerId: earner.freelancer.authId,
      status: "ACTIVE",
      title: `${PREFIX}no-profile-contract`,
    });
    const base = Date.now() - 600_000;
    const paid = await insertEarning({
      contractId: earner.contract.id,
      freelancerId: earner.freelancer.authId,
      amountCents: 4_000,
      feeCents: 400,
      createdAt: new Date(base + 3_000),
      payout: "PAID",
    });
    const pending = await insertEarning({
      contractId: earner.contract.id,
      freelancerId: earner.freelancer.authId,
      amountCents: 3_000,
      feeCents: 300,
      createdAt: new Date(base + 2_000),
      payout: "PENDING",
    });
    const unpaid = await insertEarning({
      contractId: earner.contract.id,
      freelancerId: earner.freelancer.authId,
      amountCents: 2_000,
      feeCents: 200,
      createdAt: new Date(base + 1_000),
    });
    const noProfile = await insertEarning({
      contractId: noProfileContract.id,
      freelancerId: earner.freelancer.authId,
      amountCents: 1_000,
      feeCents: 100,
      createdAt: new Date(base),
    });
    await insertEarning({
      contractId: rival.contract.id,
      freelancerId: rival.freelancer.authId,
      amountCents: 8_000,
      feeCents: 800,
      createdAt: new Date(base + 4_000),
      payout: "PAID",
    });

    const rows = await listEarningsWithPayoutState(
      db,
      earner.freelancer.authId,
    );
    expect(rows.map((row) => row.id)).toEqual([
      paid,
      pending,
      unpaid,
      noProfile,
    ]);
    expect(rows.map((row) => row.paidOut)).toEqual([true, false, false, false]);
    expect(rows[0]).toMatchObject({
      amountCents: 4_000,
      platformFeeCents: 400,
      contractTitle: `${PREFIX}earner-contract`,
    });
    expect(rows[0]?.clientCompany).toMatch(/^Company /);
    expect(rows[3]?.clientCompany).toBeNull();
    expect(rows[3]?.contractTitle).toBe(`${PREFIX}no-profile-contract`);

    const amounts = await listEarningAmounts(db, earner.freelancer.authId);
    expect(amounts.map((row) => row.amountCents).sort()).toEqual([
      1_000, 2_000, 3_000, 4_000,
    ]);
    expect(amounts.find((row) => row.amountCents === 4_000)).toMatchObject({
      platformFeeCents: 400,
    });
  });

  it("reads the certificate account only for a FREELANCER account", async () => {
    const createdAt = new Date("2024-03-01T00:00:00Z");
    const first = await insertFreelancer({
      professional_title: "Certified A",
      city: "Austin",
      created_at: createdAt,
      updated_at: new Date("2025-05-05T00:00:00Z"),
    });
    const second = await insertFreelancer({
      professional_title: "Certified B",
      city: "Berlin",
      country: "DE",
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2025-06-06T00:00:00Z"),
    });
    const clientWithProfile = await insertAccount("CLIENT");
    await db
      .insert(freelancer_metadata)
      .values({ auth_id: clientWithProfile, ...metadataValues() });

    expect(await findCertificateAccount(db, first.authId)).toEqual({
      professionalTitle: "Certified A",
      country: "US",
      city: "Austin",
      activeSince: createdAt,
      profileId: first.profileId,
    });
    expect(await findCertificateAccount(db, second.authId)).toMatchObject({
      professionalTitle: "Certified B",
      city: "Berlin",
      country: "DE",
    });
    expect(await findCertificateAccount(db, clientWithProfile)).toBe(undefined);
    expect(await findCertificateAccount(db, newAuthId())).toBe(undefined);
  });

  it("reads the payout account of a FREELANCER even without a profile", async () => {
    const withProfile = await insertFreelancer(
      { country: "DE" },
      { stripe_connect_account_id: `acct_${randomUUID()}` },
    );
    const bare = await insertAccount("FREELANCER");
    const clientAccount = await insertAccount("CLIENT");

    const profileRow = await findPayoutAccount(db, withProfile.authId);
    expect(profileRow?.email).toBe(`${withProfile.authId}@example.test`);
    expect(profileRow?.stripeConnectAccountId).toMatch(/^acct_/);
    expect(profileRow?.country).toBe("DE");

    expect(await findPayoutAccount(db, bare)).toEqual({
      email: `${bare}@example.test`,
      stripeConnectAccountId: null,
      country: null,
    });
    expect(await findPayoutAccount(db, clientAccount)).toBe(undefined);
    expect(await findPayoutAccount(db, newAuthId())).toBe(undefined);
  });
});

describe("single job reads", () => {
  it("returns a published job with its client data and nothing for a draft", async () => {
    const clientId = await insertAccount("CLIENT", {
      paymentMethodVerified: true,
      created_at: new Date("2022-02-02T00:00:00Z"),
      updated_at: new Date("2025-02-02T00:00:00Z"),
    });
    await db.insert(client_metadata).values({
      auth_id: clientId,
      role: "CLIENT",
      company_name: "Detail Co",
      company_website: "https://detail.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "Detail description",
    });
    const spentless = await insertClient();
    const published = await insertJob(clientId, { title: "Published one" });
    const other = await insertJob(spentless, { title: "Published two" });
    const draft = await insertJob(clientId, {
      title: "Draft",
      status: "DRAFT",
    });
    await db.insert(client_spents).values({
      client_id: clientId,
      total_spent_cents: 12_345,
      review_count: 4,
      rating: "4.50",
    });

    const detail = await findPublishedJobDetail(db, published.id);
    expect(detail?.job.id).toBe(published.id);
    expect(detail).toMatchObject({
      companyName: "Detail Co",
      companyDescription: "Detail description",
      paymentVerified: true,
      totalSpentCents: 12_345,
      clientRating: "4.50",
      clientReviewCount: 4,
    });
    expect(detail?.clientJoinedAt).toEqual(new Date("2022-02-02T00:00:00Z"));

    const withoutSpent = await findPublishedJobDetail(db, other.id);
    expect(withoutSpent?.job.id).toBe(other.id);
    expect(withoutSpent?.totalSpentCents).toBeNull();
    expect(await findPublishedJobDetail(db, draft.id)).toBe(undefined);
    expect(await findPublishedJobDetail(db, randomUUID())).toBe(undefined);
  });

  it("counts proposals and only active or completed hires of one job", async () => {
    const clientId = await insertClient();
    const job = await insertJob(clientId);
    const otherJob = await insertJob(clientId);
    const freelancers = await Promise.all(
      Array.from({ length: 5 }, () => insertFreelancer()),
    );
    const statuses = ["PENDING", "ACTIVE", "COMPLETED"] as const;
    for (const [index, status] of statuses.entries()) {
      await insertContract({
        jobId: job.id,
        clientId,
        freelancerId: freelancers[index]!.authId,
        status,
      });
    }
    await insertProposal(job.id, freelancers[3]!.authId);
    await insertContract({
      jobId: otherJob.id,
      clientId,
      freelancerId: freelancers[4]!.authId,
      status: "ACTIVE",
    });

    expect(await countProposalsForJob(db, job.id)).toEqual({ count: 4 });
    expect(await countHiresForJob(db, job.id)).toEqual({ count: 2 });
    expect(await countProposalsForJob(db, otherJob.id)).toEqual({ count: 1 });
    expect(await countHiresForJob(db, otherJob.id)).toEqual({ count: 1 });
    expect(await countHiresForJob(db, randomUUID())).toEqual({ count: 0 });
  });
});
