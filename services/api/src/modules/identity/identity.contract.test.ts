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
      clientDashboard: "http://localhost:3999",
      freelancerDashboard: "http://localhost:3998",
    },
  };
});

vi.mock("../../infrastructure/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    identity: { verificationSessions: { create: mocks.sessionsCreate } },
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
import { accounts } from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { identityResponses } from "./identity.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "identity-contract-it-";
const API = "/api/v1/identity";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  identityVerified: boolean,
) => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    identityVerified,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const purge = async () => {
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
  mocks.sessionsCreate.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.sessionsCreate.mockResolvedValue({
    url: "https://verify.stripe.test/session",
  });
});

describe("POST /identity/session", () => {
  it("matches the 200 schema for a client", async () => {
    const clientId = await insertAccount("CLIENT", false);
    const response = await request(app)
      .post(`${API}/session`)
      .query({ role: "client" })
      .set(as(clientId))
      .send({});
    expect(response.status).toBe(200);
    identityResponses.session[200].parse(response.body);
  });

  it("matches the 200 schema for a freelancer", async () => {
    const freelancerId = await insertAccount("FREELANCER", false);
    const response = await request(app)
      .post(`${API}/session`)
      .query({ role: "freelancer" })
      .set(as(freelancerId))
      .send({});
    expect(response.status).toBe(200);
    identityResponses.session[200].parse(response.body);
  });

  it("matches the 409 schema for a verified account", async () => {
    const clientId = await insertAccount("CLIENT", true);
    const response = await request(app)
      .post(`${API}/session`)
      .query({ role: "client" })
      .set(as(clientId))
      .send({});
    expect(response.status).toBe(409);
    identityResponses.session[409].parse(response.body);
  });
});
