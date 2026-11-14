import { createHmac, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
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
  getUser: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
}));

import {
  connectRedis,
  disconnectRedis,
  redis,
} from "../../infrastructure/redis.js";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  client_metadata,
  connects,
  connects_purchase_history,
  contract_milestones,
  contracts,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  createTestData,
  purgeLeftovers,
} from "../../test/support/factories.js";
import { adminResponses } from "./admin.responses.js";

const { app } = await import("../../app.js");

const API = "/api/v1/admin";
const PREFIX = "admin-contract-it-";
const REDIS_KEY = `connects:${PREFIX}${randomUUID()}`;

const adminToken = () => {
  const expiresAt = String(Date.now() + 60_000);
  const signature = createHmac("sha256", process.env.ADMIN_SESSION_SECRET!)
    .update(expiresAt)
    .digest("hex");
  return `${expiresAt}.${signature}`;
};

const admin = () => ({ Authorization: `Bearer ${adminToken()}` });

const data = createTestData(PREFIX);

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purgeLeftovers(PREFIX);
  await connectRedis();
  await redis.set(REDIS_KEY, "5", { EX: 120 });

  const freelancerFixture = await data.createPayoutFixture({
    owner: "freelancer",
    payout: { status: "PAID" },
    earning: { ageMs: 0 },
  });
  await data.createPayoutFixture({
    owner: "agency",
    payout: { status: "PAID" },
    earning: { ageMs: 0 },
  });
  const freelancerId = freelancerFixture.owner.freelancerId!;

  await db
    .update(contract_milestones)
    .set({
      funded_at: new Date(),
      status: "COMPLETED",
      completed_at: new Date(),
    })
    .where(inArray(contract_milestones.contract_id, data.created.contractIds));

  const jobs = await db
    .select({ clientId: job_posts.client_id })
    .from(job_posts)
    .where(inArray(job_posts.id, data.created.jobIds));
  await db.insert(client_metadata).values({
    auth_id: jobs[0]!.clientId,
    role: "CLIENT",
    company_name: "Admin Contract Co",
    company_website: "https://admin-contract.example.test",
    company_size: "1-10",
    industry: "Software",
    company_description: "Admin contract test client",
  });

  await db.insert(freelancer_metadata).values({
    auth_id: freelancerId,
    professional_title: "Backend developer",
    professional_description: "Admin contract test freelancer",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["TypeScript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  const [balance] = await db
    .insert(connects)
    .values({ freelancer_id: freelancerId, connects: 20 })
    .returning({ id: connects.id });
  await db.insert(connects_purchase_history).values({
    connects_id: balance!.id,
    purchased_connects: 20,
    amount_paid_cents: 300,
    payment_id: `${PREFIX}${randomUUID()}`,
    status: "COMPLETED",
  });
});

afterAll(async () => {
  await redis.del(REDIS_KEY);
  await data.cleanup();
  await pool.query("delete from client_metadata where auth_id like $1", [
    `${PREFIX}%`,
  ]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    `${PREFIX}%`,
  ]);
  await purgeLeftovers(PREFIX);
  await disconnectRedis();
  await pool.end();
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({
    firstName: "Test",
    lastName: "User",
    imageUrl: "https://example.test/avatar.png",
    emailAddresses: [{ emailAddress: "test.user@example.test" }],
  });
});

describe("POST /admin/auth/login", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .send({ password: process.env.ADMIN_DASHBOARD_PASSWORD });
    expect(response.status).toBe(200);
    adminResponses.login[200].parse(response.body);
  });

  it("matches the 401 schema for a wrong password", async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .send({
        password: `${process.env.ADMIN_DASHBOARD_PASSWORD}-${randomUUID()}`,
      });
    expect(response.status).toBe(401);
    adminResponses.login[401].parse(response.body);
  });
});

describe("GET /admin/overview", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app).get(`${API}/overview`).set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.overview[200].parse(response.body);
    expect(body.data.totals.contracts).toBeGreaterThan(0);
  });
});

describe("GET /admin/overview/activity", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/overview/activity`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.activity[200].parse(response.body);
    expect(body.data.results.length).toBeGreaterThan(0);
  });
});

describe("GET /admin/accounts", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/accounts`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.accounts[200].parse(response.body);
    expect(body.data.results.map((item) => item.type)).toContain("Agency");
  });
});

describe("GET /admin/job-posts", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/job-posts`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.jobPosts[200].parse(response.body);
    expect(body.data.results.length).toBeGreaterThan(0);
  });
});

describe("GET /admin/proposals", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/proposals`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.proposals[200].parse(response.body);
    expect(body.data.results.length).toBeGreaterThan(0);
  });
});

describe("GET /admin/contracts", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/contracts`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.contracts[200].parse(response.body);
    const kinds = body.data.results.map((item) => item.talentKind);
    expect(kinds).toContain("Agency");
    expect(kinds).toContain("Freelancer");
  });
});

describe("GET /admin/transactions", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/transactions`)
      .query({ limit: "100" })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.transactions[200].parse(response.body);
    const types = new Set(body.data.results.map((item) => item.type));
    expect(types).toEqual(
      new Set(["MILESTONE_FUNDED", "EARNING", "PAYOUT", "CONNECTS_PURCHASE"]),
    );
  });
});

describe("GET /admin/system/health", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/system/health`)
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.systemHealth[200].parse(response.body);
    expect(body.data.redis.ok).toBe(true);
    expect(body.data.database.ok).toBe(true);
  });
});

describe("GET /admin/system/redis/keys", () => {
  it("matches the 200 schema", async () => {
    const response = await request(app)
      .get(`${API}/system/redis/keys`)
      .query({ pattern: `${REDIS_KEY}*` })
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.redisKeys[200].parse(response.body);
    expect(body.data.keys.map((item) => item.key)).toContain(REDIS_KEY);
  });
});

describe("GET /admin/system/redis/keys/:key", () => {
  it("matches the 200 schema for a string key", async () => {
    const response = await request(app)
      .get(`${API}/system/redis/keys/${REDIS_KEY}`)
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.redisKey[200].parse(response.body);
    expect(body.data.value).toBe("5");
  });

  it("matches the 200 schema for a missing key", async () => {
    const response = await request(app)
      .get(`${API}/system/redis/keys/connects:admin-contract-it-missing`)
      .set(admin());
    expect(response.status).toBe(200);
    const body = adminResponses.redisKey[200].parse(response.body);
    expect(body.data.value).toBeNull();
  });

  it("matches the 200 schema for a hash key", async () => {
    const hashKey = `${REDIS_KEY}:hash`;
    await redis.hSet(hashKey, { field: "value" });
    try {
      const response = await request(app)
        .get(`${API}/system/redis/keys/${hashKey}`)
        .set(admin());
      expect(response.status).toBe(200);
      adminResponses.redisKey[200].parse(response.body);
    } finally {
      await redis.del(hashKey);
    }
  });

  it("matches the 403 schema for a key outside the allowlist", async () => {
    const response = await request(app)
      .get(`${API}/system/redis/keys/session:secret`)
      .set(admin());
    expect(response.status).toBe(403);
    adminResponses.redisKey[403].parse(response.body);
  });
});

describe("admin reports against real Postgres", () => {
  const Q = "admin-query-it-";
  let qdata = createTestData(Q);
  const qid = () => `${Q}${randomUUID()}`;
  const day = (month: number, date: number) =>
    new Date(Date.UTC(2099, month - 1, date));
  const OLD = new Date("2000-01-01T00:00:00.000Z");

  const purgeQuery = async () => {
    const like = `${Q}%`;
    await qdata.cleanup();
    qdata = createTestData(Q);
    await pool.query("delete from contracts where client_id like $1", [like]);
    await pool.query("delete from proposals where sender_id like $1", [like]);
    await pool.query("delete from job_posts where client_id like $1", [like]);
    await pool.query("delete from agency_metadata where owner_id like $1", [
      like,
    ]);
    await pool.query("delete from freelancer_metadata where auth_id like $1", [
      like,
    ]);
    await pool.query("delete from client_metadata where auth_id like $1", [
      like,
    ]);
    await pool.query("delete from accounts where auth_id like $1", [like]);
  };

  const insertAccounts = async (
    rows: Array<{ role: "FREELANCER" | "CLIENT"; createdAt: Date }>,
  ) => {
    const values = rows.map((row) => {
      const authId = qid();
      return {
        auth_id: authId,
        email: `${authId}@example.test`,
        role: row.role,
        created_at: row.createdAt,
        updated_at: row.createdAt,
      };
    });
    const inserted = await db
      .insert(accounts)
      .values(values)
      .returning({ id: accounts.id, authId: accounts.auth_id });
    return values.map((value) =>
      inserted.find((row) => row.authId === value.auth_id)!,
    );
  };

  const insertAgencies = async (
    owners: string[],
    createdAts: Date[],
    onboarded = true,
  ) => {
    const inserted = await db
      .insert(agency_metadata)
      .values(
        owners.map((ownerId, index) => ({
          owner_id: ownerId,
          name: `${Q}agency-${randomUUID()}`,
          size: "1-10",
          specialty: "testing",
          overview: "admin query test",
          is_onboarded: onboarded,
          created_at: createdAts[index]!,
          updated_at: createdAts[index]!,
        })),
      )
      .returning({ id: agency_metadata.id, ownerId: agency_metadata.owner_id });
    return owners.map((owner) =>
      inserted.find((row) => row.ownerId === owner)!,
    );
  };

  const insertJobs = async (clientId: string, createdAts: Date[]) =>
    db
      .insert(job_posts)
      .values(
        createdAts.map((createdAt) => ({
          client_id: clientId,
          title: `${Q}job-${randomUUID()}`,
          description: "desc",
          expertise_level: "EXPERT",
          expected_duration: "1 month",
          total_budget_cents: 100000,
          milestones: [],
          status: "PUBLISHED",
          created_at: createdAt,
          updated_at: createdAt,
        })),
      )
      .returning({ id: job_posts.id });

  const insertProposals = async (jobId: string, createdAts: Date[]) =>
    db
      .insert(proposals)
      .values(
        createdAts.map((createdAt) => ({
          job_id: jobId,
          sender_id: qid(),
          sender_type: "FREELANCER",
          cover_letter: "hi",
          bid_amount_cents: 1000,
          duration: "1 month",
          created_at: createdAt,
          updated_at: createdAt,
        })),
      )
      .returning({ id: proposals.id });

  const insertContract = async (input: {
    clientId: string;
    freelancerId: string;
    jobId: string;
    status: "PENDING" | "ACTIVE" | "COMPLETED";
    createdAt: Date;
    totalAmountCents?: number;
  }) => {
    const [proposal] = await insertProposals(input.jobId, [OLD]);
    const [contract] = await db
      .insert(contracts)
      .values({
        proposal_id: proposal!.id,
        job_id: input.jobId,
        client_id: input.clientId,
        freelancer_id: input.freelancerId,
        title: `${Q}contract-${randomUUID()}`,
        total_amount_cents: input.totalAmountCents ?? 10000,
        status: input.status,
        created_at: input.createdAt,
        updated_at: input.createdAt,
      })
      .returning({ id: contracts.id });
    return contract!.id;
  };

  const getAdmin = (
    path: string,
    query: Record<string, string | number> = {},
  ) => request(app).get(`${API}/${path}`).query(query).set(admin());

  const page = async (
    path: string,
    limit: number,
    offset: number,
  ): Promise<Array<{ id: string } & Record<string, unknown>>> => {
    const response = await getAdmin(path, { limit, offset });
    expect(response.status).toBe(200);
    return response.body.data.results;
  };
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  afterAll(async () => {
    await purgeQuery();
  });

  describe("overview totals", () => {
    const totals = async () => {
      const response = await getAdmin("overview");
      expect(response.status).toBe(200);
      return response.body.data as {
        totals: Record<string, number>;
        volume: Record<string, number>;
      };
    };

    it("counts each entity by its own table, role and status", async () => {
      await purgeQuery();
      const before = await totals();
      const freelancers = await insertAccounts([
        { role: "FREELANCER", createdAt: OLD },
        { role: "FREELANCER", createdAt: OLD },
      ]);
      const clients = await insertAccounts([
        { role: "CLIENT", createdAt: OLD },
        { role: "CLIENT", createdAt: OLD },
        { role: "CLIENT", createdAt: OLD },
      ]);
      await insertAgencies(
        freelancers.map((row) => row.authId),
        [OLD, OLD],
      );
      const jobs = await insertJobs(clients[0]!.authId, [OLD, OLD, OLD]);
      await insertProposals(jobs[0]!.id, [OLD, OLD]);
      const amounts: Array<["PENDING" | "ACTIVE" | "COMPLETED", number]> = [
        ["ACTIVE", 100],
        ["ACTIVE", 200],
        ["COMPLETED", 300],
        ["PENDING", 400],
        ["PENDING", 500],
      ];
      for (const [status, totalAmountCents] of amounts) {
        await insertContract({
          clientId: clients[0]!.authId,
          freelancerId: freelancers[0]!.authId,
          jobId: jobs[0]!.id,
          status,
          createdAt: OLD,
          totalAmountCents,
        });
      }

      const after = await totals();

      const delta = (key: keyof typeof after.totals) =>
        after.totals[key]! - before.totals[key]!;
      expect(delta("freelancers")).toBe(2);
      expect(delta("clients")).toBe(3);
      expect(delta("agencies")).toBe(2);
      expect(delta("jobPosts")).toBe(3);
      expect(delta("proposals")).toBe(7);
      expect(delta("contracts")).toBe(5);
      expect(delta("activeContracts")).toBe(2);
      expect(
        after.volume.totalContractValueCents! -
          before.volume.totalContractValueCents!,
      ).toBe(1500);
    });

    it("sums only PAID payouts and COMPLETED Connects purchases", async () => {
      await purgeQuery();
      const before = await totals();
      await qdata.createPayoutFixture({
        payout: { status: "PAID", amountCents: 7000 },
        earning: { amountCents: 8000 },
      });
      await qdata.createPayoutFixture({
        payout: { status: "PAID", amountCents: 500 },
        earning: { amountCents: 1500 },
      });
      await qdata.createPayoutFixture({
        payout: { status: "PENDING", amountCents: 3000 },
        earning: { amountCents: 4000 },
      });
      const [owner] = await insertAccounts([
        { role: "FREELANCER", createdAt: OLD },
      ]);
      await db.insert(freelancer_metadata).values({
        auth_id: owner!.authId,
        professional_title: "Developer",
        professional_description: "desc",
        hourly_rate_cents: 5000,
        country: "US",
        city: "Austin",
        weekly_availability: "30",
        experience_level: "EXPERT",
        skills: ["node"],
        languages: [{ language: "English", proficiency: "Fluent" }],
      });
      const [balance] = await db
        .insert(connects)
        .values({ freelancer_id: owner!.authId, connects: 5 })
        .returning({ id: connects.id });
      await db.insert(connects_purchase_history).values([
        {
          connects_id: balance!.id,
          purchased_connects: 20,
          amount_paid_cents: 300,
          payment_id: qid(),
          status: "COMPLETED",
        },
        {
          connects_id: balance!.id,
          purchased_connects: 20,
          amount_paid_cents: 100,
          payment_id: qid(),
          status: "PENDING",
        },
      ]);

      const after = await totals();

      expect(
        after.volume.totalPaidOutCents! - before.volume.totalPaidOutCents!,
      ).toBe(7500);
      expect(
        after.volume.totalConnectsRevenueCents! -
          before.volume.totalConnectsRevenueCents!,
      ).toBe(300);
    });
  });

  describe("paged reports", () => {
    const seeded = {} as {
      accounts: string[];
      agencies: string[];
      jobs: string[];
      proposals: string[];
      contracts: string[];
      milestoneTitles: string[];
      milestoneContract: string;
      connectsPurchases: string[];
      payouts: string[];
      earnings: string[];
      funded: string[];
      pendingPayout: string;
      clientId: string;
    };

    beforeAll(async () => {
      await purgeQuery();
      const fillerOwners = await insertAccounts(
        Array.from({ length: 16 }, () => ({
          role: "FREELANCER" as const,
          createdAt: OLD,
        })),
      );
      await insertAgencies(
        fillerOwners.map((row) => row.authId),
        fillerOwners.map(() => OLD),
      );
      const [filler] = await insertAccounts([
        { role: "CLIENT", createdAt: OLD },
      ]);
      const fillerJobs = await insertJobs(
        filler!.authId,
        Array.from({ length: 16 }, () => OLD),
      );
      for (const job of fillerJobs) {
        await insertContract({
          clientId: filler!.authId,
          freelancerId: fillerOwners[0]!.authId,
          jobId: job.id,
          status: "PENDING",
          createdAt: OLD,
        });
      }
      const fundedFillerContract = await insertContract({
        clientId: filler!.authId,
        freelancerId: fillerOwners[0]!.authId,
        jobId: fillerJobs[0]!.id,
        status: "PENDING",
        createdAt: OLD,
      });
      await db.insert(contract_milestones).values(
        Array.from({ length: 14 }, (_, index) => ({
          contract_id: fundedFillerContract,
          title: `filler-${index}`,
          amount_cents: 100,
          due_date: "2026-01-01",
          position: index,
          status: "ACTIVE" as const,
          funded_at: OLD,
        })),
      );
      for (let index = 0; index < 14; index += 1) {
        await qdata.createEarning(
          { freelancerId: fillerOwners[1]!.authId },
          { ageMs: 0 },
        );
      }
      await pool.query(
        "update earning_history set created_at = $1 where id = any($2)",
        [OLD, qdata.created.earningIds],
      );

      const futureAccounts = await insertAccounts([
        { role: "FREELANCER", createdAt: day(3, 3) },
        { role: "CLIENT", createdAt: day(3, 5) },
        { role: "FREELANCER", createdAt: day(3, 1) },
        { role: "CLIENT", createdAt: day(3, 4) },
        { role: "FREELANCER", createdAt: day(3, 2) },
      ]);
      const futureAgencies = await insertAgencies(
        [
          futureAccounts[0]!.authId,
          futureAccounts[2]!.authId,
          futureAccounts[4]!.authId,
        ],
        [day(4, 2), day(4, 1), day(4, 3)],
      );
      const clientId = futureAccounts[1]!.authId;
      const freelancerId = futureAccounts[0]!.authId;
      await db.insert(client_metadata).values({
        auth_id: clientId,
        role: "CLIENT",
        company_name: "Admin Query Co",
        company_website: "https://admin-query.example.test",
        company_size: "1-10",
        industry: "Software",
        company_description: "Admin query test client",
      });

      const futureJobs = await insertJobs(clientId, [
        day(5, 2),
        day(5, 1),
        day(5, 3),
      ]);
      const futureProposals = await insertProposals(futureJobs[0]!.id, [
        day(6, 2),
        day(6, 1),
        day(6, 3),
      ]);
      const c1 = await insertContract({
        clientId,
        freelancerId,
        jobId: futureJobs[0]!.id,
        status: "ACTIVE",
        createdAt: day(7, 2),
      });
      const c2 = await insertContract({
        clientId,
        freelancerId,
        jobId: futureJobs[0]!.id,
        status: "COMPLETED",
        createdAt: day(7, 1),
      });
      const c3 = await insertContract({
        clientId,
        freelancerId,
        jobId: futureJobs[1]!.id,
        status: "PENDING",
        createdAt: day(7, 3),
      });
      const milestones = await db
        .insert(contract_milestones)
        .values(
          [
            { title: "m2", position: 2 },
            { title: "m0", position: 0 },
            { title: "m1", position: 1 },
          ].map((row) => ({
            contract_id: c1,
            title: row.title,
            amount_cents: 100,
            due_date: "2026-01-01",
            position: row.position,
            status: "PENDING" as const,
          })),
        )
        .returning({ id: contract_milestones.id });
      expect(milestones).toHaveLength(3);
      const fundedMilestones = await db
        .insert(contract_milestones)
        .values(
          [
            { title: "f2", position: 0, fundedAt: day(8, 2) },
            { title: "f1", position: 1, fundedAt: day(8, 1) },
          ].map((row) => ({
            contract_id: c2,
            title: row.title,
            amount_cents: 100,
            due_date: "2026-01-01",
            position: row.position,
            status: "ACTIVE" as const,
            funded_at: row.fundedAt,
          })),
        )
        .returning({ id: contract_milestones.id });
      await db.insert(contract_milestones).values(
        [0, 1, 2].map((index) => ({
          contract_id: c3,
          title: `u${index}`,
          amount_cents: 100,
          due_date: "2026-01-01",
          position: index,
          status: "PENDING" as const,
        })),
      );

      const earningFixtures = [];
      for (const date of [day(9, 2), day(9, 1), day(9, 3)]) {
        const fixture = await qdata.createPayoutFixture({
          payout: { status: "PAID" },
          earning: { ageMs: 0 },
        });
        await pool.query(
          "update earning_history set created_at = $2 where id = $1",
          [fixture.earningId, date],
        );
        earningFixtures.push(fixture);
      }
      const paidAt = [day(10, 2), day(10, 1), day(10, 3)];
      for (const [index, fixture] of earningFixtures.entries()) {
        await pool.query(
          "update payout_history set paid_at = $2, created_at = $3 where id = $1",
          [fixture.payoutId, paidAt[index], OLD],
        );
      }
      const pending = await qdata.createPayoutFixture({
        payout: { status: "PENDING" },
        earning: { ageMs: 0 },
      });
      await pool.query(
        "update payout_history set created_at = $2 where id = $1",
        [pending.payoutId, day(12, 31)],
      );

      const purchaseOwners = futureAccounts.filter(
        (row) => row.authId !== clientId,
      );
      const purchaseIds: string[] = [];
      const purchaseDates = [day(11, 2), day(11, 1), day(11, 3)];
      for (const [index, owner] of purchaseOwners.slice(0, 3).entries()) {
        await db.insert(freelancer_metadata).values({
          auth_id: owner.authId,
          professional_title: "Developer",
          professional_description: "desc",
          hourly_rate_cents: 5000,
          country: "US",
          city: "Austin",
          weekly_availability: "30",
          experience_level: "EXPERT",
          skills: ["node"],
          languages: [{ language: "English", proficiency: "Fluent" }],
        });
        const [balance] = await db
          .insert(connects)
          .values({ freelancer_id: owner.authId, connects: 5 })
          .returning({ id: connects.id });
        const [purchase] = await db
          .insert(connects_purchase_history)
          .values({
            connects_id: balance!.id,
            purchased_connects: 20,
            amount_paid_cents: 300,
            payment_id: qid(),
            status: "COMPLETED",
            created_at: purchaseDates[index]!,
          })
          .returning({ id: connects_purchase_history.id });
        purchaseIds.push(purchase!.id);
      }

      const sortBy = <T extends { date: Date }>(rows: T[]) =>
        [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
      seeded.clientId = clientId;
      seeded.accounts = sortBy(
        futureAccounts.map((row, index) => ({
          id: row.id,
          authId: row.authId,
          date: [day(3, 3), day(3, 5), day(3, 1), day(3, 4), day(3, 2)][index]!,
        })),
      ).map((row) => row.id);
      seeded.agencies = sortBy(
        futureAgencies.map((row, index) => ({
          id: row.id,
          date: [day(4, 2), day(4, 1), day(4, 3)][index]!,
        })),
      ).map((row) => row.id);
      seeded.jobs = sortBy(
        futureJobs.map((row, index) => ({
          id: row.id,
          date: [day(5, 2), day(5, 1), day(5, 3)][index]!,
        })),
      ).map((row) => row.id);
      seeded.proposals = sortBy(
        futureProposals.map((row, index) => ({
          id: row.id,
          date: [day(6, 2), day(6, 1), day(6, 3)][index]!,
        })),
      ).map((row) => row.id);
      seeded.contracts = sortBy([
        { id: c1, date: day(7, 2) },
        { id: c2, date: day(7, 1) },
        { id: c3, date: day(7, 3) },
      ]).map((row) => row.id);
      seeded.milestoneTitles = ["m0", "m1", "m2"];
      seeded.milestoneContract = c1;
      seeded.funded = sortBy(
        fundedMilestones.map((row, index) => ({
          id: row.id,
          date: [day(8, 2), day(8, 1)][index]!,
        })),
      ).map((row) => row.id);
      seeded.earnings = sortBy(
        earningFixtures.map((fixture, index) => ({
          id: fixture.earningId,
          date: [day(9, 2), day(9, 1), day(9, 3)][index]!,
        })),
      ).map((row) => row.id);
      seeded.payouts = sortBy(
        earningFixtures.map((fixture, index) => ({
          id: fixture.payoutId!,
          date: paidAt[index]!,
        })),
      ).map((row) => row.id);
      seeded.pendingPayout = pending.payoutId!;
      seeded.connectsPurchases = sortBy(
        purchaseIds.map((id, index) => ({ id, date: purchaseDates[index]! })),
      ).map((row) => row.id);
    }, 120000);

    it("lists recent activity newest first across accounts, agencies, jobs and contracts", async () => {
      expect(ids(await page("overview/activity", 3, 0))).toEqual(
        seeded.contracts,
      );
      expect(ids(await page("overview/activity", 3, 3))).toEqual(seeded.jobs);
      expect(ids(await page("overview/activity", 3, 6))).toEqual(
        seeded.agencies,
      );
      expect(ids(await page("overview/activity", 5, 9))).toEqual(
        seeded.accounts,
      );
    });

    it("lists accounts and agencies newest first, including accounts without a client profile", async () => {
      const rows = await page("accounts", 8, 0);

      const expectedPeople = rows
        .filter((row) => row.type !== "Agency")
        .map((row) => row.id);
      expect(
        rows.filter((row) => row.type === "Agency").map((row) => row.id),
      ).toEqual(seeded.agencies);
      expect(rows.slice(0, 3).every((row) => row.type === "Agency")).toBe(true);
      expect(expectedPeople).toHaveLength(5);
      expect(
        rows
          .map((row) => row.name)
          .slice(3)
          .includes("Admin Query Co"),
      ).toBe(true);
    });

    it("pages job posts newest first with proposal and hire counts", async () => {
      const first = await page("job-posts", 3, 0);
      const second = await page("job-posts", 2, 1);

      expect(ids(first)).toEqual(seeded.jobs);
      expect(ids(second)).toEqual(seeded.jobs.slice(1, 3));
      const jobWithContracts = first.find((row) => row.hireCount === 2);
      expect(jobWithContracts?.proposalCount).toBe(5);
    });

    it("pages proposals newest first", async () => {
      expect(ids(await page("proposals", 3, 0))).toEqual(seeded.proposals);
      expect(ids(await page("proposals", 2, 1))).toEqual(
        seeded.proposals.slice(1, 3),
      );
    });

    it("pages contracts newest first with milestones in position order", async () => {
      expect(ids(await page("contracts", 3, 0))).toEqual(seeded.contracts);
      expect(ids(await page("contracts", 2, 1))).toEqual(
        seeded.contracts.slice(1, 3),
      );
      const rows = await page("contracts", 3, 0);
      const withMilestones = rows.find(
        (row) => row.id === seeded.milestoneContract,
      );
      expect(
        (withMilestones!.milestones as Array<{ title: string }>).map(
          (milestone) => milestone.title,
        ),
      ).toEqual(seeded.milestoneTitles);
    });

    it("lists transactions newest first from each source without duplicates", async () => {
      const first = await page("transactions", 3, 0);
      const second = await page("transactions", 3, 3);
      const third = await page("transactions", 3, 6);
      const fourth = await page("transactions", 2, 9);

      expect(ids(first)).toEqual(seeded.connectsPurchases);
      expect(ids(second)).toEqual(seeded.payouts);
      expect(ids(third)).toEqual(seeded.earnings);
      expect(ids(fourth)).toEqual(seeded.funded);
      for (const rows of [first, second, third, fourth]) {
        expect(ids(rows)).not.toContain(seeded.pendingPayout);
      }
    });
  });
});
