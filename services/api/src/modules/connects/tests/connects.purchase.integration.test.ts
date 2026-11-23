import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
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
  constructEvent: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return {
    ...original,
    env: { ...original.env, stripeConnectsWebhookSecret: "whsec_test" },
  };
});

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
    del: async () => 1,
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

import { db, pool } from "@/database/client.js";
import {
  accounts,
  agency_metadata,
  connects,
  connects_history,
  connects_purchase_history,
  freelancer_metadata,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";

const { connectsWebhook } =
  await import("@/modules/connects/controllers/connects.controller.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");
const { CONNECTS_PLANS } =
  await import("@/modules/connects/constants/connects.constants.js");

const PREFIX = "connects-purchase-it-";
const [PLAN] = Object.keys(CONNECTS_PLANS).map(Number) as [number];

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: async () => undefined,
    info: mocks.info,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), connectsWebhook);
app.use(errorHandler);

const deliver = (metadata: Record<string, string>, sessionId: string) => {
  mocks.constructEvent.mockReturnValue({
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        metadata: { purchasedConnects: String(PLAN), ...metadata },
      },
    },
  });
  return request(app)
    .post("/webhook")
    .set("content-type", "application/json")
    .set("stripe-signature", "good")
    .send("{}");
};

const seedFreelancer = async (withBalance: number | null) => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Developer",
    professional_description: "Connects purchase test",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["TypeScript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  if (withBalance !== null) {
    await db
      .insert(connects)
      .values({ freelancer_id: authId, connects: withBalance });
  }
  return authId;
};

const seedAgency = async (withBalance: number | null) => {
  const ownerId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: ownerId,
    email: `${ownerId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
  });
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}${randomUUID()}`,
      size: "1-10",
      specialty: "testing",
      overview: "connects purchase test",
    })
    .returning({ id: agency_metadata.id });
  if (withBalance !== null) {
    await db
      .insert(connects)
      .values({ agency_id: agency!.id, connects: withBalance });
  }
  return agency!.id;
};

const readState = async (
  owner: { freelancerId: string } | { agencyId: string },
) => {
  const rows = await db
    .select()
    .from(connects)
    .where(
      "agencyId" in owner
        ? eq(connects.agency_id, owner.agencyId)
        : eq(connects.freelancer_id, owner.freelancerId),
    );
  const row = rows[0];
  if (!row) return { balance: null, history: [], purchases: [] };
  const history = await db
    .select()
    .from(connects_history)
    .where(eq(connects_history.connects_id, row.id));
  const purchases = await db
    .select()
    .from(connects_purchase_history)
    .where(eq(connects_purchase_history.connects_id, row.id));
  return { balance: row.connects, history, purchases };
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query(
    "delete from connects where freelancer_id like $1 or agency_id in (select id from agency_metadata where name like $1)",
    [like],
  );
  await pool.query("delete from agency_metadata where name like $1", [like]);
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

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.store.clear();
  mocks.constructEvent.mockReset();
  mocks.info.mockReset();
  mocks.info.mockResolvedValue(undefined);
});

describe("connects purchase webhook with a missing balance row", () => {
  it("credits a freelancer without a balance row and writes one history row", async () => {
    const freelancerId = await seedFreelancer(null);

    const response = await deliver({ freelancerId }, `cs_${randomUUID()}`);

    expect(response.status).toBe(200);
    const state = await readState({ freelancerId });
    expect(state.balance).toBe(PLAN);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({
      type: "Connects purchased",
      amount: PLAN,
    });
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0]).toMatchObject({
      purchased_connects: PLAN,
      status: "COMPLETED",
    });
  });

  it("credits once when the same event is delivered twice", async () => {
    const freelancerId = await seedFreelancer(null);
    const sessionId = `cs_${randomUUID()}`;

    const first = await deliver({ freelancerId }, sessionId);
    const second = await deliver({ freelancerId }, sessionId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const state = await readState({ freelancerId });
    expect(state.balance).toBe(PLAN);
    expect(state.history).toHaveLength(1);
    expect(state.purchases).toHaveLength(1);
  });

  it("credits once when the same event is delivered concurrently", async () => {
    const freelancerId = await seedFreelancer(null);
    const sessionId = `cs_${randomUUID()}`;

    const responses = await Promise.all([
      deliver({ freelancerId }, sessionId),
      deliver({ freelancerId }, sessionId),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const state = await readState({ freelancerId });
    expect(state.balance).toBe(PLAN);
    expect(state.history).toHaveLength(1);
    expect(state.purchases).toHaveLength(1);
  });

  it("credits an agency without a balance row", async () => {
    const agencyId = await seedAgency(null);
    const sessionId = `cs_${randomUUID()}`;

    const first = await deliver({ agencyId }, sessionId);
    const second = await deliver({ agencyId }, sessionId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const state = await readState({ agencyId });
    expect(state.balance).toBe(PLAN);
    expect(state.history).toHaveLength(1);
    expect(state.purchases).toHaveLength(1);
  });

  it("adds to an existing balance and creates no second row", async () => {
    const freelancerId = await seedFreelancer(7);
    const agencyId = await seedAgency(11);

    const freelancerResponse = await deliver(
      { freelancerId },
      `cs_${randomUUID()}`,
    );
    const agencyResponse = await deliver({ agencyId }, `cs_${randomUUID()}`);

    expect(freelancerResponse.status).toBe(200);
    expect(agencyResponse.status).toBe(200);
    expect((await readState({ freelancerId })).balance).toBe(7 + PLAN);
    expect((await readState({ agencyId })).balance).toBe(11 + PLAN);
    const rows = await db
      .select({ id: connects.id })
      .from(connects)
      .where(inArray(connects.freelancer_id, [freelancerId]));
    expect(rows).toHaveLength(1);
  });
});
