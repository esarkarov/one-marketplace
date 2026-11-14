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

vi.mock("../../infrastructure/stripe.js", () => ({
  STRIPE_TIMEOUT_MS: 30_000,
  stripe: {
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
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
import {
  accounts,
  agency_metadata,
  connects,
  connects_history,
  freelancer_metadata,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
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

  it("reads the requesting freelancer's own balance from the database", async () => {
    const bystanders = [await seedFreelancer(), await seedFreelancer()];
    const freelancerId = await seedFreelancer();
    await pool.query(
      "update connects set connects = 99 where freelancer_id = any($1)",
      [bystanders],
    );
    await pool.query(
      "update connects set connects = 4321 where freelancer_id = $1",
      [freelancerId],
    );
    mocks.store.clear();

    const response = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(freelancerId));

    expect(response.status).toBe(200);
    expect(response.body.data.connects).toBe(4321);
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

describe("connects checkout account write", () => {
  const OLD = new Date("2000-01-01T00:00:00.000Z");

  const accountRow = async (authId: string) =>
    (await pool.query("select * from accounts where auth_id = $1", [authId]))
      .rows[0] as { stripe_customer_id: string | null; updated_at: Date };

  it("creates a Stripe customer once and stores its id with a fresh updated_at", async () => {
    const freelancerId = await seedFreelancer();
    const bystander = await seedFreelancer();
    await pool.query(
      "update accounts set updated_at = $1 where auth_id = any($2)",
      [OLD, [freelancerId, bystander]],
    );
    const customerId = `cus_${randomUUID()}`;
    mocks.customersCreate.mockResolvedValue({ id: customerId });
    const startedAt = Date.now();
    const checkout = () =>
      request(app)
        .post(`${API}/checkout`)
        .query({ role: "freelancer" })
        .set(as(freelancerId))
        .send({ connects: 20 });

    const first = await checkout();

    expect(first.status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      email: `${freelancerId}@example.test`,
      metadata: { freelancerId },
    });
    expect(mocks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: customerId }),
    );
    const stored = await accountRow(freelancerId);
    expect(stored.stripe_customer_id).toBe(customerId);
    expect(stored.updated_at.getTime()).toBeGreaterThanOrEqual(startedAt);
    const untouched = await accountRow(bystander);
    expect(untouched.stripe_customer_id).toBeNull();
    expect(untouched.updated_at.getTime()).toBe(OLD.getTime());

    expect((await checkout()).status).toBe(200);
    expect(mocks.customersCreate).toHaveBeenCalledTimes(1);
    expect((await accountRow(freelancerId)).updated_at).toEqual(
      stored.updated_at,
    );
  });
});

const service = await import("./connects.service.js");
const {
  INITIAL_CONNECTS,
  CONNECTS_PLANS,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
} = await import("../../config/constants.js");

describe("connects service writes against real Postgres", () => {
  const seedBareFreelancer = async () => {
    const freelancerId = await insertAccount("FREELANCER");
    await db.insert(freelancer_metadata).values({
      auth_id: freelancerId,
      professional_title: "Backend developer",
      professional_description: "Service test freelancer",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30+ hours",
      experience_level: "INTERMEDIATE",
      skills: ["TypeScript"],
      languages: [{ language: "English", proficiency: "Fluent" }],
    });
    return freelancerId;
  };

  const seedAgency = async () => {
    const ownerId = await insertAccount("FREELANCER");
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "connects service test",
      })
      .returning({ id: agency_metadata.id });
    return agency!.id;
  };

  const balanceOf = async (
    owner: { freelancerId: string } | { agencyId: string },
  ) => {
    const [row] =
      "agencyId" in owner
        ? (
            await pool.query("select * from connects where agency_id = $1", [
              owner.agencyId,
            ])
          ).rows
        : (
            await pool.query(
              "select * from connects where freelancer_id = $1",
              [owner.freelancerId],
            )
          ).rows;
    return row as
      | {
          id: string;
          connects: number;
          freelancer_id: string | null;
          agency_id: string | null;
        }
      | undefined;
  };

  const historyOf = async (connectsId: string) =>
    (
      await pool.query(
        "select type, description, amount from connects_history where connects_id = $1 order by created_at, id",
        [connectsId],
      )
    ).rows;

  const purchasesOf = async (connectsId: string) =>
    (
      await pool.query(
        "select purchased_connects, amount_paid_cents::int as amount_paid_cents, payment_id, status, connects_id from connects_purchase_history where connects_id = $1",
        [connectsId],
      )
    ).rows;

  it("gives a new freelancer the onboarding bonus once", async () => {
    const freelancerId = await seedBareFreelancer();

    const created = await service.addConnects(freelancerId);
    const repeated = await service.addConnects(freelancerId);

    expect(created).toMatchObject({
      freelancer_id: freelancerId,
      connects: INITIAL_CONNECTS,
    });
    expect(repeated).toBeUndefined();
    const balance = await balanceOf({ freelancerId });
    expect(balance!.connects).toBe(INITIAL_CONNECTS);
    expect(await historyOf(balance!.id)).toEqual([
      {
        type: "Onboarding Bonus",
        description: "New account welcome Connects",
        amount: INITIAL_CONNECTS,
      },
    ]);
    expect(mocks.store.get(getConnectsCacheKey(freelancerId))).toBe(
      String(INITIAL_CONNECTS),
    );
  });

  it("gives a new agency the onboarding bonus once", async () => {
    const agencyId = await seedAgency();

    const created = await service.addAgencyConnects(agencyId);
    const repeated = await service.addAgencyConnects(agencyId);

    expect(created).toMatchObject({
      agency_id: agencyId,
      freelancer_id: null,
      connects: INITIAL_CONNECTS,
    });
    expect(repeated).toBeUndefined();
    const balance = await balanceOf({ agencyId });
    expect(balance!.connects).toBe(INITIAL_CONNECTS);
    expect(await historyOf(balance!.id)).toEqual([
      {
        type: "Onboarding Bonus",
        description: "New agency welcome Connects",
        amount: INITIAL_CONNECTS,
      },
    ]);
    expect(mocks.store.get(getAgencyConnectsCacheKey(agencyId))).toBe(
      String(INITIAL_CONNECTS),
    );
  });

  it("reads an agency's own balance", async () => {
    const other = await seedAgency();
    const agencyId = await seedAgency();
    await db.insert(connects).values({ agency_id: other, connects: 99 });
    await db.insert(connects).values({ agency_id: agencyId, connects: 17 });
    mocks.store.clear();

    expect(await service.getAgencyConnectsBalance(agencyId)).toBe(17);
    expect(mocks.store.get(getAgencyConnectsCacheKey(agencyId))).toBe("17");
  });

  const seedHistory = async (
    owner: { freelancerId: string } | { agencyId: string },
    label: string,
  ) => {
    const [balance] = await db
      .insert(connects)
      .values(
        "agencyId" in owner
          ? { agency_id: owner.agencyId, connects: 5 }
          : { freelancer_id: owner.freelancerId, connects: 5 },
      )
      .returning({ id: connects.id });
    for (let index = 0; index < 12; index += 1) {
      await db.insert(connects_history).values({
        connects_id: balance!.id,
        type: "Test",
        description: `${label}-${index}`,
        amount: index,
        created_at: new Date(Date.UTC(2024, 0, 1, 0, index)),
      });
    }
  };

  it("lists an agency's latest ten history rows newest first", async () => {
    const other = await seedAgency();
    const agencyId = await seedAgency();
    await seedHistory({ agencyId: other }, "other");
    await seedHistory({ agencyId }, "own");

    const rows = await service.getAgencyConnectsHistory(agencyId);

    expect(rows.map((row) => row.description)).toEqual(
      Array.from({ length: 10 }, (_, index) => `own-${11 - index}`),
    );
  });

  it("lists a freelancer's latest ten history rows newest first", async () => {
    const other = await seedBareFreelancer();
    const freelancerId = await seedBareFreelancer();
    await seedHistory({ freelancerId: other }, "other");
    await seedHistory({ freelancerId }, "own");

    const rows = await service.getConnectsHistory(freelancerId);

    expect(rows.map((row) => row.description)).toEqual(
      Array.from({ length: 10 }, (_, index) => `own-${11 - index}`),
    );
  });

  it("credits a completed freelancer purchase once and records it", async () => {
    const freelancerId = await seedBareFreelancer();
    const bystander = await seedBareFreelancer();
    await db.insert(connects).values({ freelancer_id: bystander, connects: 7 });
    await db
      .insert(connects)
      .values({ freelancer_id: freelancerId, connects: 10 });
    const paymentId = `cs_${randomUUID()}`;

    await service.completeConnectsPurchase(freelancerId, 40, paymentId);
    await service.completeConnectsPurchase(freelancerId, 40, paymentId);

    const balance = await balanceOf({ freelancerId });
    expect(balance!.connects).toBe(50);
    expect((await balanceOf({ freelancerId: bystander }))!.connects).toBe(7);
    expect(await purchasesOf(balance!.id)).toEqual([
      {
        purchased_connects: 40,
        amount_paid_cents: CONNECTS_PLANS[40],
        payment_id: paymentId,
        status: "COMPLETED",
        connects_id: balance!.id,
      },
    ]);
    expect(await historyOf(balance!.id)).toEqual([
      {
        type: "Connects purchased",
        description: "Purchased 40 Connects",
        amount: 40,
      },
    ]);
    expect(mocks.store.get(getConnectsCacheKey(freelancerId))).toBe("50");
  });

  it("credits a completed agency purchase once and records it", async () => {
    const agencyId = await seedAgency();
    const bystander = await seedAgency();
    await db.insert(connects).values({ agency_id: bystander, connects: 7 });
    await db.insert(connects).values({ agency_id: agencyId, connects: 10 });
    const paymentId = `cs_${randomUUID()}`;

    await service.completeAgencyConnectsPurchase(agencyId, 80, paymentId);
    await service.completeAgencyConnectsPurchase(agencyId, 80, paymentId);

    const balance = await balanceOf({ agencyId });
    expect(balance!.connects).toBe(90);
    expect((await balanceOf({ agencyId: bystander }))!.connects).toBe(7);
    expect(await purchasesOf(balance!.id)).toEqual([
      {
        purchased_connects: 80,
        amount_paid_cents: CONNECTS_PLANS[80],
        payment_id: paymentId,
        status: "COMPLETED",
        connects_id: balance!.id,
      },
    ]);
    expect(await historyOf(balance!.id)).toEqual([
      {
        type: "Connects purchased",
        description: "Purchased 80 Connects",
        amount: 80,
      },
    ]);
    expect(mocks.store.get(getAgencyConnectsCacheKey(agencyId))).toBe("90");
  });
});
