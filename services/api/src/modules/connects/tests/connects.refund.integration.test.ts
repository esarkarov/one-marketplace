import { randomUUID } from "node:crypto";
import express from "express";
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
  constructEvent: vi.fn(),
  refundsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  failCredit: null as Error | null,
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return {
    ...original,
    env: { ...original.env, stripeConnectsWebhookSecret: "whsec_test" },
  };
});

vi.mock("@/config/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/logger.js")>();
  return {
    ...original,
    logger: {
      ...original.logger,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
    },
  };
});

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent },
    refunds: { create: mocks.refundsCreate },
    checkout: { sessions: { retrieve: mocks.sessionsRetrieve } },
  },
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

vi.mock(
  "@/modules/connects/repositories/connects.repository.js",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/modules/connects/repositories/connects.repository.js")
      >();
    return {
      ...original,
      creditConnects: async (
        ...args: Parameters<typeof original.creditConnects>
      ) => {
        if (mocks.failCredit) throw mocks.failCredit;
        return original.creditConnects(...args);
      },
    };
  },
);

import { db, pool } from "@/database/client.js";
import {
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

const PREFIX = "connects-refund-it-";
const [PLAN] = Object.keys(CONNECTS_PLANS).map(Number) as [number];

const app = express();
app.use((req, _res, next) => {
  req.logger = {
    warn: async () => undefined,
    info: async () => undefined,
    error: async () => undefined,
  } as unknown as typeof req.logger;
  next();
});
app.post("/webhook", express.raw({ type: "*/*" }), connectsWebhook);
app.use(errorHandler);

const deliver = (
  metadata: Record<string, string>,
  sessionId: string,
  paymentIntent: string | null,
) => {
  mocks.constructEvent.mockReturnValue({
    id: `evt_${randomUUID()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: paymentIntent,
        amount_total: CONNECTS_PLANS[PLAN as keyof typeof CONNECTS_PLANS],
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

const seedFreelancer = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Developer",
    professional_description: "Connects refund test",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["TypeScript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  return authId;
};

const purchasesFor = (sessionId: string) =>
  db
    .select()
    .from(connects_purchase_history)
    .where(eq(connects_purchase_history.payment_id, sessionId));

const balanceRowsFor = (freelancerId: string) =>
  db.select().from(connects).where(eq(connects.freelancer_id, freelancerId));

const agencyBalanceRowsFor = (agencyId: string) =>
  db.select().from(connects).where(eq(connects.agency_id, agencyId));

const refundKeys = () =>
  mocks.refundsCreate.mock.calls.map(
    (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
  );

const loggedEvents = () =>
  [...mocks.loggerWarn.mock.calls, ...mocks.loggerError.mock.calls].map(
    (call) => (call[0] as { eventName: string }).eventName,
  );

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from connects where freelancer_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
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
  mocks.failCredit = null;
  mocks.constructEvent.mockReset();
  mocks.refundsCreate.mockReset();
  mocks.refundsCreate.mockResolvedValue({ id: "re_1", status: "succeeded" });
  mocks.sessionsRetrieve.mockReset();
  mocks.loggerWarn.mockReset();
  mocks.loggerError.mockReset();
});

describe("connects webhook for an owner without a profile row", () => {
  it("refunds a freelancer purchase with the stable key and answers 200", async () => {
    const freelancerId = `${PREFIX}${randomUUID()}`;
    const sessionId = `cs_${randomUUID()}`;
    const paymentIntent = `pi_${randomUUID()}`;

    const response = await deliver({ freelancerId }, sessionId, paymentIntent);

    expect(response.status).toBe(200);
    expect(mocks.refundsCreate).toHaveBeenCalledExactlyOnceWith(
      { payment_intent: paymentIntent, reason: "duplicate" },
      { idempotencyKey: `refund:${paymentIntent}:duplicate:connects` },
    );
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: "Paid Connects checkout session cannot be credited. Refunding.",
      eventName: "payment.unfulfillable",
      attributes: {
        "stripe.checkout_session_id": sessionId,
        "stripe.payment_intent_id": paymentIntent,
        "payment.unfulfillable_reason": "owner_profile_missing",
        "user.id": freelancerId,
      },
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith({
      message: "Payment refunded.",
      eventName: "payment.refunded",
      attributes: {
        "stripe.checkout_session_id": sessionId,
        "stripe.payment_intent_id": paymentIntent,
        "payment.refund_cause": "owner_profile_missing",
        "payment.amount_cents":
          CONNECTS_PLANS[PLAN as keyof typeof CONNECTS_PLANS],
      },
    });
    expect(await balanceRowsFor(freelancerId)).toEqual([]);
    expect(await purchasesFor(sessionId)).toEqual([]);
  });

  it("refunds an agency purchase when the agency row is missing", async () => {
    const agencyId = randomUUID();
    const paymentIntent = `pi_${randomUUID()}`;

    const response = await deliver(
      { agencyId },
      `cs_${randomUUID()}`,
      paymentIntent,
    );

    expect(response.status).toBe(200);
    expect(refundKeys()).toEqual([
      `refund:${paymentIntent}:duplicate:connects`,
    ]);
    expect(await agencyBalanceRowsFor(agencyId)).toEqual([]);
  });

  it("reuses the same key on a duplicate delivery and never credits", async () => {
    const freelancerId = `${PREFIX}${randomUUID()}`;
    const sessionId = `cs_${randomUUID()}`;
    const paymentIntent = `pi_${randomUUID()}`;

    const first = await deliver({ freelancerId }, sessionId, paymentIntent);
    const second = await deliver({ freelancerId }, sessionId, paymentIntent);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(mocks.refundsCreate).toHaveBeenCalledTimes(2);
    for (const call of [1, 2]) {
      expect(mocks.refundsCreate).toHaveBeenNthCalledWith(
        call,
        { payment_intent: paymentIntent, reason: "duplicate" },
        { idempotencyKey: `refund:${paymentIntent}:duplicate:connects` },
      );
    }
    expect(await balanceRowsFor(freelancerId)).toEqual([]);
    expect(await purchasesFor(sessionId)).toEqual([]);
    const history = await db
      .select({ id: connects_history.id })
      .from(connects_history)
      .innerJoin(connects, eq(connects.id, connects_history.connects_id))
      .where(eq(connects.freelancer_id, freelancerId));
    expect(history).toEqual([]);
  });

  it("answers 200 without a refund log when Stripe reports the charge already refunded", async () => {
    mocks.refundsCreate.mockRejectedValue({ code: "charge_already_refunded" });

    const response = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      `cs_${randomUUID()}`,
      `pi_${randomUUID()}`,
    );

    expect(response.status).toBe(200);
    expect(loggedEvents()).toEqual(["payment.unfulfillable"]);
  });

  it("reads the payment intent from the session when the event omits it", async () => {
    const sessionId = `cs_${randomUUID()}`;
    mocks.sessionsRetrieve.mockResolvedValue({
      id: sessionId,
      payment_intent: { id: "pi_from_session" },
    });

    const response = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      sessionId,
      null,
    );

    expect(response.status).toBe(200);
    expect(mocks.sessionsRetrieve).toHaveBeenCalledWith(sessionId, {
      expand: ["payment_intent"],
    });
    expect(refundKeys()).toEqual(["refund:pi_from_session:duplicate:connects"]);
  });

  it("answers 500 when no payment intent can be resolved", async () => {
    const sessionId = `cs_${randomUUID()}`;
    mocks.sessionsRetrieve.mockResolvedValue({
      id: sessionId,
      payment_intent: null,
    });

    const response = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      sessionId,
      null,
    );

    expect(response.status).toBe(500);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(loggedEvents()).toContain("payment.refund.no_payment_intent");
  });

  it("answers 500 so Stripe retries when the refund fails transiently", async () => {
    mocks.refundsCreate.mockRejectedValue(
      Object.assign(new Error("down"), {
        type: "StripeConnectionError",
        name: "StripeConnectionError",
      }),
    );

    const response = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      `cs_${randomUUID()}`,
      `pi_${randomUUID()}`,
    );

    expect(response.status).toBe(500);
    expect(loggedEvents()).toContain("payment.refund.failed");
    expect(loggedEvents()).not.toContain("payment.refund.unrecoverable");
  });

  it("answers 200 with the unrecoverable log on a permanent refund error", async () => {
    const paymentIntent = `pi_${randomUUID()}`;
    mocks.refundsCreate.mockRejectedValue(
      Object.assign(new Error("not refundable"), {
        code: "charge_not_refundable",
      }),
    );

    const response = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      `cs_${randomUUID()}`,
      paymentIntent,
    );

    expect(response.status).toBe(200);
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: "Payment refund is permanently unrecoverable.",
      eventName: "payment.refund.unrecoverable",
      attributes: {
        "stripe.event_id": expect.stringMatching(/^evt_/),
        "stripe.payment_intent_id": paymentIntent,
        "error.code": "charge_not_refundable",
      },
    });
  });
});

describe("connects webhook protections", () => {
  it("never refunds a session that was already credited", async () => {
    const freelancerId = await seedFreelancer();
    const sessionId = `cs_${randomUUID()}`;
    const paymentIntent = `pi_${randomUUID()}`;

    const credited = await deliver({ freelancerId }, sessionId, paymentIntent);
    expect(credited.status).toBe(200);
    expect(await purchasesFor(sessionId)).toHaveLength(1);

    const redelivered = await deliver(
      { freelancerId: `${PREFIX}${randomUUID()}` },
      sessionId,
      paymentIntent,
    );

    expect(redelivered.status).toBe(200);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(await purchasesFor(sessionId)).toHaveLength(1);
    const [balance] = await balanceRowsFor(freelancerId);
    expect(balance?.connects).toBe(PLAN);
  });

  it("answers 500 without a refund when crediting fails transiently", async () => {
    const freelancerId = await seedFreelancer();
    const sessionId = `cs_${randomUUID()}`;
    mocks.failCredit = Object.assign(new Error("terminating connection"), {
      code: "57P01",
    });

    const response = await deliver(
      { freelancerId },
      sessionId,
      `pi_${randomUUID()}`,
    );

    expect(response.status).toBe(500);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
    expect(await purchasesFor(sessionId)).toEqual([]);
  });

  it("answers 500 without a refund for a foreign key violation on another constraint", async () => {
    const freelancerId = await seedFreelancer();
    mocks.failCredit = Object.assign(new Error("fk"), {
      code: "23503",
      constraint: "connects_history_connects_id_connects_id_fk",
    });

    const response = await deliver(
      { freelancerId },
      `cs_${randomUUID()}`,
      `pi_${randomUUID()}`,
    );

    expect(response.status).toBe(500);
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });
});
