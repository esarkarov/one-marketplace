import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
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
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  upload: vi.fn(),
  accountsCreate: vi.fn(),
  loginLink: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_test_stripe",
      imageKitPrivateKey: "ik_test",
      freelancerDashboard: "http://localhost:3002",
    },
  };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    v2: { core: { accounts: { create: mocks.accountsCreate } } },
    accounts: { createLoginLink: mocks.loginLink },
  },
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: vi.fn() } },
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mocks.store.delete(key);
      }
      return 1;
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

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
  job_posts,
  payout_history,
  proposals,
  reviews,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import {
  freelancerEarningsCertificateResponses,
  freelancerEarningsOverviewResponses,
  freelancerEarningsSummaryResponses,
  freelancerJobDetailResponses,
  freelancerJobFeedResponses,
  freelancerPayoutLinkResponses,
  freelancerProfileGetResponses,
  freelancerProfilePutResponses,
  freelancerPublicProfileResponses,
  freelancerSearchResponses,
} from "./freelancer.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "freelancer-contract-";
const API = "/api/v1/freelancer";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const q = { role: "freelancer" };

const insertAccount = async (
  authId: string,
  role: "CLIENT" | "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
    ...extra,
  });
  return authId;
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const profileBody = {
  role: "freelancer",
  freelancer_metadata: {
    professional_title: "Backend developer",
    professional_description: "I build APIs.",
    hourly_rate_cents: 6000,
    country: "US",
    city: "Austin",
    availability_status: "AVAILABLE",
    weekly_availability: "30",
    experience_level: "EXPERT",
    skills: ["node", "postgres", "typescript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  },
  freelancer_portfolios: [
    {
      title: "Shop",
      category: "Web",
      description: "A shop.",
      live_url: "https://shop.example.test",
      cover_image: { url: "data:image/png;base64,iVBORw0KGgo=" },
    },
  ],
};

const seedFreelancer = async () => {
  const freelancerId = await insertAccount(newAuthId(), "FREELANCER", {
    identityVerified: true,
  });
  const saved = await request(app)
    .put(`${API}/profile`)
    .set(as(freelancerId))
    .send(profileBody);
  expect(saved.status).toBe(200);
  return { freelancerId, saved };
};

const seedMarket = async (freelancerId: string) => {
  const clientId = await insertAccount(newAuthId(), "CLIENT", {
    paymentMethodVerified: true,
  });
  await db.insert(client_metadata).values({
    auth_id: clientId,
    role: "Founder",
    company_name: "Acme",
    company_website: "https://acme.example.test",
    company_size: "11-50",
    industry: "Software",
    company_description: "We build things.",
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db.insert(client_spents).values({
    client_id: clientId,
    total_spent_cents: 250000,
    completed_contracts: 2,
    review_count: 2,
    rating: "4.50",
  });

  const jobValues = (title: string) => ({
    client_id: clientId,
    title,
    description: "Build with node and postgres",
    expertise_level: "EXPERT",
    expected_duration: "1 month",
    skills: ["node", "postgres"],
    total_budget_cents: 100000,
    milestones: [
      {
        id: "m1",
        title: "First",
        budgetCents: 100000,
        dueDate: "2026-12-01",
      },
    ],
    screening_questions: ["Why you?"],
    attachments: [
      {
        fileId: "f1",
        fileName: "brief.pdf",
        fileUrl: "https://files.example.test/brief.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
      },
    ],
    status: "PUBLISHED",
    published_at: new Date(),
  });
  const [openJob] = await db
    .insert(job_posts)
    .values(jobValues("Node API job"))
    .returning({ id: job_posts.id });
  const [doneJob] = await db
    .insert(job_posts)
    .values(jobValues("Finished job"))
    .returning({ id: job_posts.id });
  const [activeJob] = await db
    .insert(job_posts)
    .values(jobValues("Active job"))
    .returning({ id: job_posts.id });

  const proposal = async (jobId: string) =>
    (
      await db
        .insert(proposals)
        .values({
          job_id: jobId,
          sender_id: freelancerId,
          sender_type: "FREELANCER",
          cover_letter: "hello",
          bid_amount_cents: 100000,
          duration: "1 month",
        })
        .returning({ id: proposals.id })
    )[0]!.id;

  const [done] = await db
    .insert(contracts)
    .values({
      proposal_id: await proposal(doneJob!.id),
      job_id: doneJob!.id,
      client_id: clientId,
      freelancer_id: freelancerId,
      title: "Finished contract",
      total_amount_cents: 100000,
      status: "COMPLETED",
      completed_at: new Date(),
    })
    .returning({ id: contracts.id });
  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: done!.id,
      title: "m1",
      amount_cents: 100000,
      due_date: "2026-01-01",
      position: 0,
      status: "COMPLETED",
    })
    .returning({ id: contract_milestones.id });
  await db.insert(reviews).values([
    {
      contract_id: done!.id,
      reviewer_id: clientId,
      reviewee_id: freelancerId,
      rating: 5,
      comment: "great",
    },
    {
      contract_id: done!.id,
      reviewer_id: freelancerId,
      reviewee_id: clientId,
      rating: 4,
      comment: "good client",
    },
  ]);
  await db.insert(contracts).values({
    proposal_id: await proposal(activeJob!.id),
    job_id: activeJob!.id,
    client_id: clientId,
    freelancer_id: freelancerId,
    title: "Active contract",
    total_amount_cents: 50000,
    status: "ACTIVE",
    started_at: new Date(),
  });

  const [paid] = await db
    .insert(earning_history)
    .values({
      freelancer_id: freelancerId,
      contract_id: done!.id,
      milestone_id: milestone!.id,
      amount_cents: 100000,
      platform_fee_cents: 10000,
      description: "paid out",
    })
    .returning({ id: earning_history.id });
  await db.insert(payout_history).values({
    freelancer_id: freelancerId,
    earning_history_id: paid!.id,
    amount_cents: 90000,
    status: "PAID",
    stripe_transfer_id: `tr_${randomUUID()}`,
    paid_at: new Date(),
  });
  await db
    .update(earning_history)
    .set({ created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
    .where(eq(earning_history.id, paid!.id));
  const [milestone2] = await db
    .insert(contract_milestones)
    .values({
      contract_id: done!.id,
      title: "m2",
      amount_cents: 20000,
      due_date: "2026-02-01",
      position: 1,
      status: "COMPLETED",
    })
    .returning({ id: contract_milestones.id });
  await db.insert(earning_history).values({
    freelancer_id: freelancerId,
    contract_id: done!.id,
    milestone_id: milestone2!.id,
    amount_cents: 20000,
    platform_fee_cents: 2000,
    description: "fresh",
  });
  await db.insert(freelancer_earning).values({
    freelancer_id: freelancerId,
    total_earning_cents: 108000,
    completed_jobs: 1,
    ongoing_jobs: 1,
    review_count: 1,
    job_success_score: "90.00",
    rating: "5.00",
  });

  const agencyOwnerId = await insertAccount(newAuthId(), "FREELANCER");
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: agencyOwnerId,
      name: `${PREFIX}agency`,
      size: "1-10",
      specialty: "design",
      overview: "overview",
      avatar_image: { imageId: "img", url: "https://example.test/a.png" },
    })
    .returning({ id: agency_metadata.id });
  await db.insert(agency_members).values({
    agency_id: agency!.id,
    freelancer_id: freelancerId,
    role: "Founder",
  });

  return { clientId, openJobId: openJob!.id };
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.store.clear();
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
  mocks.upload.mockReset();
  mocks.accountsCreate.mockReset();
  mocks.loginLink.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.getUser.mockResolvedValue({
    firstName: "Fiona",
    lastName: "Freelancer",
    fullName: "Fiona Freelancer",
    imageUrl: "https://example.test/f.png",
    unsafeMetadata: { country: "US" },
  });
  mocks.upload.mockImplementation(async () => ({
    fileId: `file_${randomUUID()}`,
    url: "https://ik.example.test/cover.png",
  }));
});

describe("freelancer contract", () => {
  it("GET /profile answers null before onboarding and the full profile after", async () => {
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");

    const empty = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(freelancerId));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();
    freelancerProfileGetResponses[200].parse(empty.body);

    const saved = await request(app)
      .put(`${API}/profile`)
      .set(as(freelancerId))
      .send(profileBody);
    expect(saved.status).toBe(200);
    freelancerProfilePutResponses[200].parse(saved.body);

    const { freelancerId: seededId } = await seedFreelancer();
    await seedMarket(seededId);
    const full = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(seededId));
    expect(full.status).toBe(200);
    expect(full.body.data.workHistory.length).toBe(2);
    expect(full.body.data.agency).not.toBeNull();
    expect(full.body.data.portfolios.length).toBe(1);
    freelancerProfileGetResponses[200].parse(full.body);
  });

  it("answers 403 and 404 with the declared bodies", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");

    const forbidden = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(clientId));
    expect(forbidden.status).toBe(403);
    freelancerProfileGetResponses[403].parse(forbidden.body);

    const forbiddenPut = await request(app)
      .put(`${API}/profile`)
      .set(as(clientId))
      .send(profileBody);
    expect(forbiddenPut.status).toBe(403);
    freelancerProfilePutResponses[403].parse(forbiddenPut.body);

    const missingPublic = await request(app).get(
      `${API}/profile/${randomUUID()}`,
    );
    expect(missingPublic.status).toBe(404);
    freelancerPublicProfileResponses[404].parse(missingPublic.body);

    const missingJob = await request(app)
      .get(`${API}/jobs/${randomUUID()}`)
      .query(q)
      .set(as(freelancerId));
    expect(missingJob.status).toBe(404);
    freelancerJobDetailResponses[404].parse(missingJob.body);

    const noProfileFeed = await request(app)
      .get(`${API}/jobs`)
      .query(q)
      .set(as(freelancerId));
    expect(noProfileFeed.status).toBe(404);
    freelancerJobFeedResponses[404].parse(noProfileFeed.body);

    const noProfileCertificate = await request(app)
      .get(`${API}/earnings/certificate`)
      .query(q)
      .set(as(freelancerId));
    expect(noProfileCertificate.status).toBe(404);
    freelancerEarningsCertificateResponses[404].parse(
      noProfileCertificate.body,
    );
  });

  it("serves public profile, search, jobs, earnings, certificate and payout link", async () => {
    const { freelancerId } = await seedFreelancer();
    const { openJobId } = await seedMarket(freelancerId);

    const [metadata] = await pool
      .query<{ id: string }>(
        "select id from freelancer_metadata where auth_id = $1",
        [freelancerId],
      )
      .then((result) => result.rows);

    const publicProfile = await request(app).get(
      `${API}/profile/${metadata!.id}`,
    );
    expect(publicProfile.status).toBe(200);
    freelancerPublicProfileResponses[200].parse(publicProfile.body);

    const search = await request(app)
      .get(`${API}/search`)
      .query({ query: "fiona" });
    expect(search.status).toBe(200);
    expect(search.body.data.results.length).toBeGreaterThan(0);
    freelancerSearchResponses[200].parse(search.body);

    const feed = await request(app)
      .get(`${API}/jobs`)
      .query(q)
      .set(as(freelancerId));
    expect(feed.status).toBe(200);
    expect(feed.body.data.length).toBeGreaterThan(0);
    expect(feed.body.data[0].matchScore).toBeGreaterThan(0);
    freelancerJobFeedResponses[200].parse(feed.body);

    const recent = await request(app)
      .get(`${API}/jobs`)
      .query({ ...q, filter: "recent" })
      .set(as(freelancerId));
    expect(recent.status).toBe(200);
    freelancerJobFeedResponses[200].parse(recent.body);

    const detail = await request(app)
      .get(`${API}/jobs/${openJobId}`)
      .query(q)
      .set(as(freelancerId));
    expect(detail.status).toBe(200);
    freelancerJobDetailResponses[200].parse(detail.body);

    const summary = await request(app)
      .get(`${API}/earnings/summary`)
      .query(q)
      .set(as(freelancerId));
    expect(summary.status).toBe(200);
    expect(summary.body.data.hasEarnings).toBe(true);
    freelancerEarningsSummaryResponses[200].parse(summary.body);

    const overview = await request(app)
      .get(`${API}/earnings/overview`)
      .query(q)
      .set(as(freelancerId));
    expect(overview.status).toBe(200);
    const statuses = overview.body.data.recentEarnings.map(
      (item: { status: string }) => item.status,
    );
    expect(statuses).toContain("WITHDRAWN");
    expect(statuses).toContain("PENDING");
    freelancerEarningsOverviewResponses[200].parse(overview.body);

    const certificate = await request(app)
      .get(`${API}/earnings/certificate`)
      .query(q)
      .set(as(freelancerId))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(certificate.status).toBe(200);
    expect(certificate.headers["content-type"]).toContain("application/pdf");
    freelancerEarningsCertificateResponses[200].parse(
      (certificate.body as Buffer).toString("latin1"),
    );
    expect((certificate.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

    mocks.accountsCreate.mockResolvedValue({
      id: "acct_test",
      requirements: { entries: [] },
    });
    mocks.loginLink.mockResolvedValue({
      url: "https://connect.example.test/login",
    });
    const payout = await request(app)
      .get(`${API}/payouts/connect-link`)
      .query(q)
      .set(as(freelancerId));
    expect(payout.status).toBe(200);
    freelancerPayoutLinkResponses[200].parse(payout.body);
  });

  it("payout link answers 403 for a client account", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");

    const response = await request(app)
      .get(`${API}/payouts/connect-link`)
      .query(q)
      .set(as(clientId));

    expect(response.status).toBe(403);
    freelancerPayoutLinkResponses[403].parse(response.body);
  });
});
