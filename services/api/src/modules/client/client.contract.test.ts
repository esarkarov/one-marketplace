import { randomUUID } from "node:crypto";
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
  customersCreate: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_test_stripe",
      clientDashboard: "http://localhost:3001",
    },
  };
});

vi.mock("../../config/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
}));

vi.mock("../../config/stripe.js", () => ({
  stripe: {
    customers: { create: mocks.customersCreate },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  },
}));

vi.mock("../../config/redis.js", () => ({
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
  agency_metadata,
  client_spents,
  contract_milestones,
  contracts,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  proposals,
  reviews,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import {
  clientCompletedContractsResponses,
  clientDashboardOverviewResponses,
  clientFinanceLinkResponses,
  clientHiringOverviewResponses,
  clientMarketplaceSearchResponses,
  clientProfileGetResponses,
  clientProfilePutResponses,
} from "./client.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "client-contract-";
const API = "/api/v1/client";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const q = { role: "client" };

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

const seedCompletedWork = async (clientId: string) => {
  const freelancerId = await insertAccount(newAuthId(), "FREELANCER", {
    identityVerified: true,
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
      tags: ["figma", "branding"],
      is_onboarded: true,
      avatar_image: { imageId: "img_1", url: "https://example.test/a.png" },
      professional_title: "Design studio",
    })
    .returning({ id: agency_metadata.id });
  await db.insert(freelancer_metadata).values({
    auth_id: freelancerId,
    professional_title: "Backend developer",
    professional_description: "desc",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30",
    experience_level: "EXPERT",
    skills: ["node", "postgres"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  await db.insert(freelancer_earning).values({
    freelancer_id: freelancerId,
    rating: "4.80",
    job_success_score: "92.50",
  });

  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Contract job",
      description: "desc",
      expertise_level: "EXPERT",
      expected_duration: "1 month",
      total_budget_cents: 100000,
      milestones: [],
      status: "PUBLISHED",
    })
    .returning({ id: job_posts.id });
  const [job2] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Second job",
      description: "desc",
      expertise_level: "INTERMEDIATE",
      expected_duration: "2 weeks",
      total_budget_cents: 50000,
      milestones: [],
      status: "PUBLISHED",
    })
    .returning({ id: job_posts.id });

  const makeProposal = async (jobId: string, senderId: string, type: string) =>
    (
      await db
        .insert(proposals)
        .values({
          job_id: jobId,
          sender_id: senderId,
          sender_type: type,
          cover_letter: "hi",
          bid_amount_cents: 100000,
          duration: "1 month",
          is_shortlisted: true,
        })
        .returning({ id: proposals.id })
    )[0]!.id;

  const proposalId = await makeProposal(job!.id, freelancerId, "FREELANCER");
  const [done] = await db
    .insert(contracts)
    .values({
      proposal_id: proposalId,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: freelancerId,
      title: "Completed contract",
      total_amount_cents: 100000,
      status: "COMPLETED",
      completed_at: new Date(),
    })
    .returning({ id: contracts.id });
  await db.insert(contract_milestones).values({
    contract_id: done!.id,
    title: "m1",
    amount_cents: 100000,
    due_date: "2026-01-01",
    position: 0,
    status: "COMPLETED",
  });
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

  const agencyProposalId = await makeProposal(
    job2!.id,
    agencyOwnerId,
    "AGENCY",
  );
  const [agencyContract] = await db
    .insert(contracts)
    .values({
      proposal_id: agencyProposalId,
      job_id: job2!.id,
      client_id: clientId,
      agency_id: agency!.id,
      title: "Agency contract",
      total_amount_cents: 60000,
      status: "ACTIVE",
      started_at: new Date(),
    })
    .returning({ id: contracts.id });
  await db.insert(contract_milestones).values([
    {
      contract_id: agencyContract!.id,
      title: "a1",
      amount_cents: 20000,
      due_date: "2026-02-01",
      position: 0,
      status: "COMPLETED",
    },
    {
      contract_id: agencyContract!.id,
      title: "a2",
      amount_cents: 40000,
      due_date: "2026-03-01",
      position: 1,
      status: "ACTIVE",
      funded_at: new Date(),
    },
  ]);
  return { freelancerId };
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
  mocks.customersCreate.mockReset();
  mocks.portalCreate.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.getUser.mockResolvedValue({
    firstName: "Fiona",
    lastName: "Freelancer",
    fullName: "Fiona Freelancer",
    imageUrl: "https://example.test/f.png",
  });
});

const profileBody = {
  role: "client",
  professionalRole: "Founder",
  companyName: "Acme",
  companyWebsite: "https://acme.example.test",
  companySize: "11-50",
  industry: "Software",
  companyDescription: "We build things.",
};

describe("client contract", () => {
  it("GET /profile answers the null profile before onboarding and the profile after", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");

    const empty = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(clientId));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();
    clientProfileGetResponses[200].parse(empty.body);

    const saved = await request(app)
      .put(`${API}/profile`)
      .set(as(clientId))
      .send(profileBody);
    expect(saved.status).toBe(200);
    clientProfilePutResponses[200].parse(saved.body);

    const full = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(clientId));
    expect(full.body.data.companyName).toBe("Acme");
    clientProfileGetResponses[200].parse(full.body);
  });

  it("answers 403 with the declared body without a client account", async () => {
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");

    const get = await request(app)
      .get(`${API}/profile`)
      .query(q)
      .set(as(freelancerId));
    expect(get.status).toBe(403);
    clientProfileGetResponses[403].parse(get.body);

    const put = await request(app)
      .put(`${API}/profile`)
      .set(as(freelancerId))
      .send(profileBody);
    expect(put.status).toBe(403);
    clientProfilePutResponses[403].parse(put.body);
  });

  it("serves the hiring, dashboard, completed-contracts and search payloads with real data", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");
    await request(app)
      .put(`${API}/profile`)
      .set(as(clientId))
      .send(profileBody);
    await db.insert(client_spents).values({
      client_id: clientId,
      total_spent_cents: 120000,
      completed_contracts: 1,
      ongoing_contracts: 1,
      review_count: 1,
      rating: "4.50",
    });
    await seedCompletedWork(clientId);

    const hiring = await request(app)
      .get(`${API}/hiring-overview`)
      .query(q)
      .set(as(clientId));
    expect(hiring.status).toBe(200);
    expect(hiring.body.data.totalHires).toBe(2);
    clientHiringOverviewResponses[200].parse(hiring.body);

    const dashboard = await request(app)
      .get(`${API}/dashboard-overview`)
      .query(q)
      .set(as(clientId));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.inProgressContracts).toHaveLength(1);
    expect(dashboard.body.data.activeJobPosts.length).toBeGreaterThan(0);
    clientDashboardOverviewResponses[200].parse(dashboard.body);

    const completed = await request(app)
      .get(`${API}/completed-contracts`)
      .query(q)
      .set(as(clientId));
    expect(completed.status).toBe(200);
    expect(completed.body.data).toHaveLength(1);
    expect(completed.body.data[0].clientReview).not.toBeNull();
    expect(completed.body.data[0].talentReview).not.toBeNull();
    clientCompletedContractsResponses[200].parse(completed.body);

    const freelancers = await request(app)
      .get(`${API}/marketplace/search`)
      .query({ ...q, type: "freelancer", query: "fiona" })
      .set(as(clientId));
    expect(freelancers.status).toBe(200);
    expect(freelancers.body.data.results.length).toBeGreaterThan(0);
    clientMarketplaceSearchResponses[200].parse(freelancers.body);

    const agencies = await request(app)
      .get(`${API}/marketplace/search`)
      .query({ ...q, type: "agency", query: "design" })
      .set(as(clientId));
    expect(
      agencies.body.data.results.some(
        (item: { accountType: string }) => item.accountType === "Agency",
      ),
    ).toBe(true);
    clientMarketplaceSearchResponses[200].parse(agencies.body);
  });

  it("GET /finances/manage-link answers the declared 200 with a mocked Stripe", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");
    mocks.customersCreate.mockResolvedValue({ id: "cus_test" });
    mocks.portalCreate.mockResolvedValue({
      url: "https://billing.example.test/session",
    });

    const response = await request(app)
      .get(`${API}/finances/manage-link`)
      .query(q)
      .set(as(clientId));

    expect(response.status).toBe(200);
    clientFinanceLinkResponses[200].parse(response.body);
  });
});
