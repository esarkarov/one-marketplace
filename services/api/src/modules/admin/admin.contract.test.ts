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
  client_metadata,
  connects,
  connects_purchase_history,
  contract_milestones,
  freelancer_metadata,
  job_posts,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { createTestData, purgeLeftovers } from "../../test/factories.js";
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
