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
  onDel: vi.fn(async (_keys: string | string[]) => undefined),
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  customersCreate: vi.fn(),
  portalCreate: vi.fn(),
}));

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

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/stripe.js", () => ({
  stripe: {
    customers: { create: mocks.customersCreate },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  },
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
      await mocks.onDel(keys);
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
  client_metadata,
  client_spents,
  conversation_participants,
  conversations,
  messages,
  contract_milestones,
  contracts,
  freelancer_earning,
  reviews,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { getAccountAuthCacheKey } from "../../config/constants.js";
import {
  getClientFinanceManagementUrl,
  getClientProfile,
  saveClientProfile,
} from "./client.service.js";
import {
  findAgencyNamesByIds,
  findReviewsForContracts,
} from "./client.repository.js";
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
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
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
  mocks.onDel.mockReset();
  mocks.onDel.mockResolvedValue(undefined);
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

describe("client account writes", () => {
  const OLD = new Date("2000-01-01T00:00:00.000Z");

  const accountRow = async (authId: string) =>
    (await pool.query("select * from accounts where auth_id = $1", [authId]))
      .rows[0] as {
      stripe_customer_id: string | null;
      updated_at: Date;
      isOnboardingComplete: boolean;
      role: string;
    };

  it("creates a Stripe customer once and stores its id with a fresh updated_at", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT", {
      updated_at: OLD,
    });
    const bystander = await insertAccount(newAuthId(), "CLIENT", {
      updated_at: OLD,
    });
    const customerId = `cus_${randomUUID()}`;
    mocks.customersCreate.mockResolvedValue({ id: customerId });
    mocks.portalCreate.mockResolvedValue({
      url: "https://billing.example.test/session",
    });
    const startedAt = Date.now();

    const first = await request(app)
      .get(`${API}/finances/manage-link`)
      .query(q)
      .set(as(clientId));

    expect(first.status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      email: `${clientId}@example.test`,
      metadata: { accountId: clientId, role: "CLIENT" },
    });
    const stored = await accountRow(clientId);
    expect(stored.stripe_customer_id).toBe(customerId);
    expect(stored.updated_at.getTime()).toBeGreaterThanOrEqual(startedAt);
    const untouched = await accountRow(bystander);
    expect(untouched.stripe_customer_id).toBeNull();
    expect(untouched.updated_at.getTime()).toBe(OLD.getTime());

    const second = await request(app)
      .get(`${API}/finances/manage-link`)
      .query(q)
      .set(as(clientId));
    expect(second.status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledTimes(1);
    expect((await accountRow(clientId)).updated_at).toEqual(stored.updated_at);
  });

  it("keeps the new Stripe customer id even when the billing portal call fails", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT");
    const customerId = `cus_${randomUUID()}`;
    mocks.customersCreate.mockResolvedValue({ id: customerId });
    mocks.portalCreate.mockRejectedValue(new Error("portal down"));

    await expect(getClientFinanceManagementUrl(clientId)).rejects.toThrow(
      "portal down",
    );

    expect((await accountRow(clientId)).stripe_customer_id).toBe(customerId);
  });

  it("marks onboarding complete, returns the verification flags and drops the cached auth after the commit", async () => {
    const clientId = await insertAccount(newAuthId(), "CLIENT", {
      identityVerified: true,
      paymentMethodVerified: false,
      updated_at: OLD,
    });
    await request(app).get(`${API}/profile`).query(q).set(as(clientId));
    const cacheKey = getAccountAuthCacheKey(clientId, "client");
    expect(mocks.store.has(cacheKey)).toBe(true);
    const flagsAtInvalidation: unknown[] = [];
    mocks.onDel.mockImplementation(async () => {
      const result = await pool.query(
        'select "isOnboardingComplete" as flag from accounts where auth_id = $1',
        [clientId],
      );
      flagsAtInvalidation.push(result.rows[0]?.flag);
    });
    const startedAt = Date.now();

    const saved = await request(app)
      .put(`${API}/profile`)
      .set(as(clientId))
      .send(profileBody);

    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      identityVerified: true,
      paymentMethodVerified: false,
      isOnboarded: true,
    });
    const row = await accountRow(clientId);
    expect(row.isOnboardingComplete).toBe(true);
    expect(row.role).toBe("CLIENT");
    expect(row.updated_at.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(mocks.store.has(cacheKey)).toBe(false);
    expect(flagsAtInvalidation.length).toBeGreaterThan(0);
    expect(flagsAtInvalidation.every((flag) => flag === true)).toBe(true);

    const verifiedCardId = await insertAccount(newAuthId(), "CLIENT", {
      identityVerified: false,
      paymentMethodVerified: true,
      updated_at: OLD,
    });
    const savedVerifiedCard = await request(app)
      .put(`${API}/profile`)
      .set(as(verifiedCardId))
      .send(profileBody);
    expect(savedVerifiedCard.status).toBe(200);
    expect(savedVerifiedCard.body.data).toMatchObject({
      identityVerified: false,
      paymentMethodVerified: true,
      isOnboarded: true,
    });
  });

  it("answers 404 and writes nothing when the account is not a client", async () => {
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER", {
      updated_at: OLD,
    });

    await expect(
      saveClientProfile({
        userId: freelancerId,
        professionalRole: "Founder",
        companyName: "Acme",
        companyWebsite: "https://acme.example.test",
        companySize: "11-50",
        industry: "Software",
        companyDescription: "We build things.",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Client account not found.",
    });

    const row = await accountRow(freelancerId);
    expect(row.isOnboardingComplete).toBe(false);
    expect(row.updated_at.getTime()).toBe(OLD.getTime());
    const metadata = await pool.query(
      "select 1 from client_metadata where auth_id = $1",
      [freelancerId],
    );
    expect(metadata.rowCount).toBe(0);
  });
});

describe("client queries against real Postgres", () => {
  const clientRow = (authId: string, companyName: string) => ({
    auth_id: authId,
    role: "Founder",
    company_name: companyName,
    company_website: "https://acme.example.test",
    company_size: "11-50",
    industry: "Software",
    company_description: "We build things.",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const mkClient = (extra: Partial<typeof accounts.$inferInsert> = {}) =>
    insertAccount(newAuthId(), "CLIENT", extra);
  const mkFreelancer = () => insertAccount(newAuthId(), "FREELANCER");

  const mkJob = async (
    clientId: string,
    overrides: Partial<typeof job_posts.$inferInsert> = {},
  ) => {
    const [job] = await db
      .insert(job_posts)
      .values({
        client_id: clientId,
        title: `${PREFIX}job-${randomUUID()}`,
        description: "desc",
        expertise_level: "EXPERT",
        expected_duration: "1 month",
        total_budget_cents: 100000,
        milestones: [],
        status: "PUBLISHED",
        ...overrides,
      })
      .returning();
    return job!;
  };

  const mkProposal = async (
    jobId: string,
    overrides: Partial<typeof proposals.$inferInsert> = {},
  ) => {
    const [proposal] = await db
      .insert(proposals)
      .values({
        job_id: jobId,
        sender_id: newAuthId(),
        sender_type: "FREELANCER",
        cover_letter: "hi",
        bid_amount_cents: 1000,
        duration: "1 month",
        ...overrides,
      })
      .returning({ id: proposals.id });
    return proposal!.id;
  };

  const mkContract = async (
    clientId: string,
    freelancerId: string,
    jobId: string,
    status: "PENDING" | "ACTIVE" | "COMPLETED",
    overrides: Partial<typeof contracts.$inferInsert> = {},
  ) => {
    const proposalId = await mkProposal(jobId);
    const [contract] = await db
      .insert(contracts)
      .values({
        proposal_id: proposalId,
        job_id: jobId,
        client_id: clientId,
        freelancer_id: freelancerId,
        title: `${PREFIX}contract-${randomUUID()}`,
        total_amount_cents: 10000,
        status,
        ...overrides,
      })
      .returning();
    return contract!;
  };

  const mkSpents = (
    clientId: string,
    overrides: Partial<typeof client_spents.$inferInsert> = {},
  ) =>
    db.insert(client_spents).values({
      client_id: clientId,
      total_spent_cents: 120000,
      completed_contracts: 1,
      ongoing_contracts: 1,
      review_count: 1,
      rating: "4.50",
      ...overrides,
    });

  const mkBystanderSpents = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      await mkSpents(await mkClient(), {
        total_spent_cents: 777 + index,
        completed_contracts: 9,
        ongoing_contracts: 9,
        rating: "1.00",
      });
    }
  };

  const get = (
    path: string,
    userId: string,
    query: Record<string, string> = {},
  ) =>
    request(app)
      .get(`${API}/${path}`)
      .query({ ...q, ...query })
      .set(as(userId));

  describe("profile", () => {
    it("reads only the requesting client's profile and its verification flags", async () => {
      const bystander = await mkClient({
        identityVerified: true,
        paymentMethodVerified: false,
      });
      await db
        .insert(client_metadata)
        .values(clientRow(bystander, "Bystander"));
      const clientId = await mkClient({
        identityVerified: false,
        paymentMethodVerified: true,
      });
      await db.insert(client_metadata).values(clientRow(clientId, "Mine"));
      const notAClient = await mkFreelancer();
      await db
        .insert(client_metadata)
        .values(clientRow(notAClient, "Misplaced"));

      expect(await getClientProfile(clientId)).toMatchObject({
        companyName: "Mine",
        identityVerified: false,
        paymentMethodVerified: true,
      });
      expect(await getClientProfile(notAClient)).toBeNull();
    });

    it("stores every profile field on insert and on update without moving created_at", async () => {
      const clientId = await mkClient();
      const first = {
        userId: clientId,
        professionalRole: "Founder",
        companyName: "Acme",
        companyWebsite: "https://acme.example.test",
        companySize: "11-50",
        industry: "Software",
        companyDescription: "First description",
      };
      const second = {
        userId: clientId,
        professionalRole: "CTO",
        companyName: "Beta",
        companyWebsite: "https://beta.example.test",
        companySize: "51-200",
        industry: "Fintech",
        companyDescription: "Second description",
      };
      const stored = async () =>
        (
          await pool.query(
            "select role, company_name, company_website, company_size, industry, company_description, created_at, updated_at from client_metadata where auth_id = $1",
            [clientId],
          )
        ).rows;

      await saveClientProfile(first);
      const [afterInsert] = await stored();
      expect(afterInsert).toMatchObject({
        role: "Founder",
        company_name: "Acme",
        company_website: "https://acme.example.test",
        company_size: "11-50",
        industry: "Software",
        company_description: "First description",
      });

      await saveClientProfile(second);
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        role: "CTO",
        company_name: "Beta",
        company_website: "https://beta.example.test",
        company_size: "51-200",
        industry: "Fintech",
        company_description: "Second description",
      });
      expect(rows[0].created_at).toEqual(afterInsert.created_at);
      expect(rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
        afterInsert.updated_at.getTime(),
      );
    });

    it("reports joinedAt from created_at and refreshes only updated_at when a profile is saved again", async () => {
      const created = new Date("2020-01-01T00:00:00.000Z");
      const updated = new Date("2021-01-01T00:00:00.000Z");
      const clientId = await mkClient();
      await db.insert(client_metadata).values({
        ...clientRow(clientId, "Old"),
        created_at: created,
        updated_at: updated,
      });
      const input = {
        userId: clientId,
        professionalRole: "CTO",
        companyName: "New",
        companyWebsite: "https://new.example.test",
        companySize: "51-200",
        industry: "Fintech",
        companyDescription: "Rewritten",
      };

      expect((await getClientProfile(clientId))!.joinedAt).toEqual(created);

      const saved = await saveClientProfile(input);

      expect(saved.joinedAt).toEqual(created);
      const [row] = (
        await pool.query(
          "select created_at, updated_at from client_metadata where auth_id = $1",
          [clientId],
        )
      ).rows;
      expect(row.created_at).toEqual(created);
      expect(row.updated_at.getTime()).toBeGreaterThan(updated.getTime());
    });

    it("stamps created_at with the save time when the profile is first inserted", async () => {
      const clientId = await mkClient();
      const startedAt = Date.now();

      const saved = await saveClientProfile({
        userId: clientId,
        professionalRole: "Founder",
        companyName: "Fresh",
        companyWebsite: "https://fresh.example.test",
        companySize: "1-10",
        industry: "Software",
        companyDescription: "Fresh",
      });

      const [row] = (
        await pool.query(
          "select created_at, updated_at from client_metadata where auth_id = $1",
          [clientId],
        )
      ).rows;
      expect(row.created_at.getTime()).toBeGreaterThanOrEqual(startedAt);
      expect(row.created_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect(row.updated_at).toEqual(row.created_at);
      expect(saved.joinedAt).toEqual(row.created_at);
    });

    it("refuses the finance link for an account that is not a client", async () => {
      const freelancerId = await mkFreelancer();

      await expect(
        getClientFinanceManagementUrl(freelancerId),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mocks.customersCreate).not.toHaveBeenCalled();
    });
  });

  describe("hiring overview", () => {
    it("counts only the client's own spend, jobs and replies", async () => {
      const bystander = await mkClient();
      await mkSpents(bystander, {
        total_spent_cents: 777,
        completed_contracts: 9,
        ongoing_contracts: 9,
        rating: "1.00",
      });
      const clientId = await mkClient();
      await mkSpents(clientId, {
        total_spent_cents: 123457,
        completed_contracts: 1,
        ongoing_contracts: 1,
        rating: "4.50",
      });
      await mkBystanderSpents(3);
      for (let index = 0; index < 3; index += 1) await mkJob(bystander);
      await mkJob(clientId);
      await mkJob(clientId);
      await mkJob(clientId, { status: "DRAFT" });

      const talent = await mkFreelancer();
      const other = await mkFreelancer();
      const base = Date.UTC(2024, 0, 1);
      const conversation = async (
        participants: string[],
        messageRows: Array<{
          sender: string;
          offsetSeconds: number;
          system?: boolean;
        }>,
      ) => {
        const [row] = await db
          .insert(conversations)
          .values({ context_key: `${PREFIX}${randomUUID()}` })
          .returning({ id: conversations.id });
        await db.insert(conversation_participants).values(
          participants.map((accountId) => ({
            conversation_id: row!.id,
            account_id: accountId,
            participant_type: "CLIENT",
          })),
        );
        for (const message of messageRows) {
          await db.insert(messages).values({
            conversation_id: row!.id,
            sender_id: message.sender,
            message_type: message.system ? "SYSTEM_EVENT" : "USER",
            event_type: message.system ? "TEST_EVENT" : null,
            body: "hi",
            created_at: new Date(base + message.offsetSeconds * 1000),
          });
        }
      };
      await conversation(
        [clientId, talent],
        [
          { sender: talent, offsetSeconds: 0 },
          { sender: clientId, offsetSeconds: 60 },
          { sender: talent, offsetSeconds: 120 },
        ],
      );
      await conversation(
        [clientId, talent],
        [
          { sender: talent, offsetSeconds: 0, system: true },
          { sender: clientId, offsetSeconds: 600 },
        ],
      );
      await conversation(
        [clientId, talent],
        [
          { sender: clientId, offsetSeconds: 0 },
          { sender: clientId, offsetSeconds: 1000 },
        ],
      );
      await conversation(
        [clientId, talent],
        [
          { sender: talent, offsetSeconds: 0 },
          { sender: talent, offsetSeconds: 300 },
        ],
      );
      await conversation(
        [talent, other],
        [
          { sender: other, offsetSeconds: 0 },
          { sender: clientId, offsetSeconds: 5000 },
        ],
      );

      const response = await get("hiring-overview", clientId);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        totalSpentCents: 123457,
        completedContracts: 1,
        rating: 4.5,
        openJobs: 2,
        totalHires: 2,
        hireRate: 67,
      });
      expect(response.body.data.averageResponseDays).toBeCloseTo(60 / 86400, 8);
    });
  });

  describe("hiring overview columns and reply windows", () => {
    it("reports completed contracts apart from ongoing ones", async () => {
      const clientId = await mkClient();
      await mkSpents(clientId, {
        total_spent_cents: 5000,
        completed_contracts: 3,
        ongoing_contracts: 1,
        rating: "3.00",
      });

      const response = await get("hiring-overview", clientId);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        completedContracts: 3,
        totalHires: 4,
        rating: 3,
      });
    });

    it("measures each reply inside its own conversation", async () => {
      const clientId = await mkClient();
      const talent = await mkFreelancer();
      const base = Date.UTC(2024, 0, 1);
      const open = async () => {
        const [row] = await db
          .insert(conversations)
          .values({ context_key: `${PREFIX}${randomUUID()}` })
          .returning({ id: conversations.id });
        await db.insert(conversation_participants).values(
          [clientId, talent].map((accountId) => ({
            conversation_id: row!.id,
            account_id: accountId,
            participant_type: "CLIENT",
          })),
        );
        return (message: { sender: string; offsetSeconds: number }) =>
          db.insert(messages).values({
            conversation_id: row!.id,
            sender_id: message.sender,
            message_type: "USER",
            body: "hi",
            created_at: new Date(base + message.offsetSeconds * 1000),
          });
      };
      const first = await open();
      const second = await open();
      await first({ sender: talent, offsetSeconds: 0 });
      await second({ sender: talent, offsetSeconds: 5 });
      await first({ sender: clientId, offsetSeconds: 60 });

      const response = await get("hiring-overview", clientId);

      expect(response.status).toBe(200);
      expect(response.body.data.averageResponseDays).toBeCloseTo(60 / 86400, 8);
    });
  });

  describe("dashboard overview", () => {
    it("summarizes only the client's own proposals, active contracts and newest published jobs", async () => {
      const bystander = await mkClient();
      await mkSpents(bystander, {
        total_spent_cents: 777,
        ongoing_contracts: 9,
        completed_contracts: 9,
      });
      const clientId = await mkClient();
      await mkSpents(clientId, {
        total_spent_cents: 123457,
        ongoing_contracts: 1,
        completed_contracts: 2,
      });
      await mkBystanderSpents(3);
      const talent = await mkFreelancer();

      const bystanderJob = await mkJob(bystander);
      await mkProposal(bystanderJob.id);
      await mkProposal(bystanderJob.id, { is_shortlisted: true });
      const foreign = await mkContract(
        bystander,
        talent,
        bystanderJob.id,
        "ACTIVE",
      );
      await db.insert(contract_milestones).values({
        contract_id: foreign.id,
        title: "foreign",
        amount_cents: 500,
        due_date: "2026-01-01",
        position: 0,
        status: "ACTIVE",
        funded_at: new Date(),
      });

      const jobs = [];
      for (let index = 0; index < 7; index += 1) {
        jobs.push(
          await mkJob(clientId, {
            created_at: new Date(Date.UTC(2024, index, 1)),
          }),
        );
      }
      await mkJob(clientId, {
        status: "DRAFT",
        created_at: new Date(Date.UTC(2025, 0, 1)),
      });
      await mkProposal(jobs[6]!.id);
      await mkProposal(jobs[6]!.id);
      await mkProposal(jobs[5]!.id, { is_shortlisted: true });
      await mkProposal(jobs[4]!.id, { status: "VIEWED", is_shortlisted: true });

      const active = await mkContract(clientId, talent, jobs[0]!.id, "ACTIVE", {
        title: "Active contract",
        total_amount_cents: 10000,
      });
      await mkContract(clientId, talent, jobs[1]!.id, "PENDING");
      await mkContract(clientId, talent, jobs[2]!.id, "COMPLETED", {
        completed_at: new Date(),
      });
      await db.insert(contract_milestones).values([
        {
          contract_id: active.id,
          title: "done",
          amount_cents: 2000,
          due_date: "2026-01-01",
          position: 0,
          status: "COMPLETED",
        },
        {
          contract_id: active.id,
          title: "done and funded",
          amount_cents: 1000,
          due_date: "2026-01-02",
          position: 1,
          status: "COMPLETED",
          funded_at: new Date(),
        },
        {
          contract_id: active.id,
          title: "funded",
          amount_cents: 3000,
          due_date: "2026-01-03",
          position: 2,
          status: "ACTIVE",
          funded_at: new Date(),
        },
        {
          contract_id: active.id,
          title: "unfunded",
          amount_cents: 4000,
          due_date: "2026-01-04",
          position: 3,
          status: "ACTIVE",
        },
      ]);

      const response = await get("dashboard-overview", clientId);

      expect(response.status).toBe(200);
      const data = response.body.data;
      expect(data).toMatchObject({
        openJobs: 7,
        totalProposals: 7,
        newProposals: 6,
        shortlistedProposals: 1,
        activeContracts: 1,
        totalContracts: 3,
        totalSpentCents: 123457,
        currentlyFundedCents: 3000,
      });
      expect(data.inProgressContracts).toEqual([
        { id: active.id, title: "Active contract", progressPercent: 30 },
      ]);
      expect(
        data.activeJobPosts.map(
          (job: { id: string; proposalCount: number }) => [
            job.id,
            job.proposalCount,
          ],
        ),
      ).toEqual([
        [jobs[6]!.id, 2],
        [jobs[5]!.id, 1],
        [jobs[4]!.id, 1],
        [jobs[3]!.id, 0],
        [jobs[2]!.id, 1],
      ]);
    });
  });

  describe("completed contracts", () => {
    it("lists only the client's completed contracts, newest completion first", async () => {
      const clientId = await mkClient();
      const bystander = await mkClient();
      const talent = await mkFreelancer();
      const job = await mkJob(clientId);
      const foreignJob = await mkJob(bystander);
      const completedAt = [
        "2024-01-01",
        "2024-04-01",
        "2024-02-01",
        "2024-03-01",
      ];
      const created = [];
      for (const [index, date] of completedAt.entries()) {
        created.push(
          await mkContract(clientId, talent, job.id, "COMPLETED", {
            title: `Contract ${index}`,
            completed_at: new Date(date),
          }),
        );
      }
      await mkContract(bystander, talent, foreignJob.id, "COMPLETED", {
        title: "Foreign",
        completed_at: new Date("2024-05-01"),
      });
      await mkContract(clientId, talent, job.id, "ACTIVE", { title: "Active" });

      const response = await get("completed-contracts", clientId);

      expect(response.status).toBe(200);
      expect(
        response.body.data.map((row: { title: string }) => row.title),
      ).toEqual(["Contract 1", "Contract 3", "Contract 2", "Contract 0"]);
    });

    it("looks up reviews and agency names only for the ids it is given", async () => {
      const clientId = await mkClient();
      const talent = await mkFreelancer();
      const job = await mkJob(clientId);
      const mine = await mkContract(clientId, talent, job.id, "COMPLETED");
      const other = await mkContract(clientId, talent, job.id, "COMPLETED");
      for (const contract of [mine, other]) {
        await db.insert(reviews).values({
          contract_id: contract.id,
          reviewer_id: clientId,
          reviewee_id: talent,
          rating: 5,
          comment: `for-${contract.id}`,
        });
      }
      const ownerA = await mkFreelancer();
      const ownerB = await mkFreelancer();
      const [agencyA, agencyB] = await db
        .insert(agency_metadata)
        .values(
          [ownerA, ownerB].map((ownerId, index) => ({
            owner_id: ownerId,
            name: `${PREFIX}names-${index}-${randomUUID()}`,
            size: "1-10",
            specialty: "names",
            overview: "overview",
          })),
        )
        .returning({ id: agency_metadata.id });

      const reviewRows = await findReviewsForContracts(db, [mine.id]);
      const agencyRows = await findAgencyNamesByIds(db, [agencyA!.id]);

      expect(reviewRows.map((row) => row.contractId)).toEqual([mine.id]);
      expect(agencyRows.map((row) => row.id)).toEqual([agencyA!.id]);
      expect(agencyRows.map((row) => row.id)).not.toContain(agencyB!.id);
    });
  });

  describe("marketplace search", () => {
    const search = (query: Record<string, string | number>) =>
      request(app)
        .get(`${API}/marketplace/search`)
        .query({ ...q, ...query })
        .set(as(callerId));

    const searchAll = async (type: string, text: string) => {
      const found: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < 2000; offset += 20) {
        const response = await request(app)
          .get(`${API}/marketplace/search`)
          .query({ ...q, type, query: text, offset })
          .set(as(callerId));
        expect(response.status).toBe(200);
        found.push(...response.body.data.results);
        if (!response.body.data.hasMore) break;
      }
      return found;
    };

    let callerId: string;
    beforeEach(async () => {
      callerId = await mkClient();
    });

    const seedFreelancers = async (count: number, title: string) => {
      const authIds = Array.from({ length: count }, () => newAuthId());
      await db.insert(accounts).values(
        authIds.map((authId) => ({
          auth_id: authId,
          email: `${authId}@example.test`,
          role: "FREELANCER" as const,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      );
      await db.insert(freelancer_metadata).values(
        authIds.map((authId) => ({
          auth_id: authId,
          professional_title: title,
          professional_description: "desc",
          hourly_rate_cents: 5000,
          country: "US",
          city: "Austin",
          weekly_availability: "30",
          experience_level: "EXPERT",
          skills: ["node"],
          languages: [{ language: "English", proficiency: "Fluent" }],
        })),
      );
      return authIds;
    };

    const seedAgencies = async (
      count: number,
      specialty: string,
      onboarded: boolean,
    ) => {
      const owners = await Promise.all(
        Array.from({ length: count }, () => mkFreelancer()),
      );
      await db.insert(agency_metadata).values(
        owners.map((ownerId) => ({
          owner_id: ownerId,
          name: `${PREFIX}agency-${randomUUID()}`,
          size: "1-10",
          specialty,
          overview: "overview",
          is_onboarded: onboarded,
        })),
      );
    };

    it("pages freelancers by twenty with an offset", async () => {
      await seedFreelancers(22, "Pager");
      const total = (
        await pool.query(
          "select count(*)::int as n from freelancer_metadata fm join accounts a on a.auth_id = fm.auth_id",
        )
      ).rows[0].n as number;

      const first = await search({ type: "freelancer" });
      const last = await search({ type: "freelancer", offset: total - 1 });

      expect(first.body.data.hasMore).toBe(true);
      expect(last.body.data.hasMore).toBe(false);
      expect(last.body.data.results.length).toBeLessThanOrEqual(1);
    });

    it("pages onboarded agencies by twenty with an offset", async () => {
      await seedAgencies(22, "pager-agency", true);
      const total = (
        await pool.query(
          "select count(*)::int as n from agency_metadata am join accounts a on a.auth_id = am.owner_id where am.is_onboarded = true",
        )
      ).rows[0].n as number;

      const first = await search({ type: "agency" });
      const last = await search({ type: "agency", offset: total - 1 });

      expect(first.body.data.hasMore).toBe(true);
      expect(last.body.data.hasMore).toBe(false);
      expect(last.body.data.results.length).toBeLessThanOrEqual(1);
    });

    it("lists freelancers that have no earnings record yet", async () => {
      const title = `${PREFIX}noearn-${randomUUID()}`;
      await seedFreelancers(1, title);

      const found = await searchAll("freelancer", title);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ jobSuccess: 0, rating: 0 });
    });

    it("lists only onboarded agencies", async () => {
      const hidden = `${PREFIX}hidden-${randomUUID()}`;
      const shown = `${PREFIX}shown-${randomUUID()}`;
      await seedAgencies(1, hidden, false);
      await seedAgencies(1, shown, true);

      expect(await searchAll("agency", hidden)).toHaveLength(0);
      expect(await searchAll("agency", shown)).toHaveLength(1);
    });
  });
});
