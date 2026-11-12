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
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_stripe_test",
      freelancerDashboard: "http://localhost:3998",
    },
  };
});

vi.mock("../../config/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
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
  connects,
  connects_history,
  freelancer_metadata,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { connectsResponses } from "./connects.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "connects-contract-it-";
const API = "/api/v1/connects";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
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

const seedFreelancer = async () => {
  const freelancerId = await insertAccount("FREELANCER");
  await db.insert(freelancer_metadata).values({
    auth_id: freelancerId,
    professional_title: "Backend developer",
    professional_description: "Contract test freelancer",
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
    .values({ freelancer_id: freelancerId, connects: 30 })
    .returning({ id: connects.id });
  await db.insert(connects_history).values([
    {
      connects_id: balance!.id,
      type: "Onboarding Bonus",
      description: "New account welcome Connects",
      amount: 30,
    },
    {
      connects_id: balance!.id,
      type: "Proposal submitted",
      description: "Proposal for a job",
      amount: -5,
    },
  ]);
  return freelancerId;
};

const purge = async () => {
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    `${PREFIX}%`,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [
    `${PREFIX}%`,
  ]);
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
  mocks.customersCreate.mockReset();
  mocks.sessionsCreate.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.customersCreate.mockImplementation(async () => ({
    id: `cus_${randomUUID()}`,
  }));
  mocks.sessionsCreate.mockResolvedValue({ url: "https://stripe.test/pay" });
});

describe("GET /connects", () => {
  it("matches the 200 schema", async () => {
    const freelancerId = await seedFreelancer();
    const response = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(freelancerId));
    expect(response.status).toBe(200);
    const body = connectsResponses.balance[200].parse(response.body);
    expect(body.data.connects).toBe(30);
  });

  it("matches the 403 schema for a client account", async () => {
    const clientId = await insertAccount("CLIENT");
    const response = await request(app)
      .get(API)
      .query({ role: "client" })
      .set(as(clientId));
    expect(response.status).toBe(403);
    connectsResponses.balance[403].parse(response.body);
  });
});

describe("GET /connects/history", () => {
  it("matches the 200 schema", async () => {
    const freelancerId = await seedFreelancer();
    const response = await request(app)
      .get(`${API}/history`)
      .query({ role: "freelancer" })
      .set(as(freelancerId));
    expect(response.status).toBe(200);
    const body = connectsResponses.history[200].parse(response.body);
    expect(body.data).toHaveLength(2);
  });

  it("matches the 403 schema for a client account", async () => {
    const clientId = await insertAccount("CLIENT");
    const response = await request(app)
      .get(`${API}/history`)
      .query({ role: "client" })
      .set(as(clientId));
    expect(response.status).toBe(403);
    connectsResponses.history[403].parse(response.body);
  });
});

describe("POST /connects/checkout", () => {
  it("matches the 200 schema", async () => {
    const freelancerId = await seedFreelancer();
    const response = await request(app)
      .post(`${API}/checkout`)
      .query({ role: "freelancer" })
      .set(as(freelancerId))
      .send({ connects: 20 });
    expect(response.status).toBe(200);
    connectsResponses.checkout[200].parse(response.body);
  });

  it("matches the 403 schema for a client account", async () => {
    const clientId = await insertAccount("CLIENT");
    const response = await request(app)
      .post(`${API}/checkout`)
      .query({ role: "client" })
      .set(as(clientId))
      .send({ connects: 20 });
    expect(response.status).toBe(403);
    connectsResponses.checkout[403].parse(response.body);
  });
});
