import { randomUUID } from "node:crypto";
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
  envState: { stripeSecretKey: "sk_stripe_test" as string | undefined },
  list: vi.fn(),
  writeCalls: [] as string[],
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  const env = { ...original.env };
  Object.defineProperty(env, "stripeSecretKey", {
    enumerable: true,
    get: () => mocks.envState.stripeSecretKey,
  });
  return { ...original, env };
});

vi.mock("@/config/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/logger.js")>();
  return {
    ...original,
    logger: {
      ...original.logger,
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
    },
  };
});

vi.mock("@/infrastructure/payments/stripe.client.js", () => {
  const recorder = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        const next = [...path, String(key)];
        if (next.join(".") === "checkout.sessions.list") return mocks.list;
        return recorder(next);
      },
      apply: () => {
        mocks.writeCalls.push(path.join("."));
        return Promise.resolve({});
      },
    });
  return { stripe: recorder([]) };
});

import { db, pool } from "@/database/client.js";
import {
  accounts,
  contract_milestones,
  contracts,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { detectOrphanPaidSessions } from "@/modules/contracts/services/contracts.orphan-payment-detection.service.js";

const PREFIX = "contracts-orphan-it-";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-19T12:00:00.000Z");
const AMOUNT = 20000;

const sec = (ms: number) => Math.floor(ms / 1000);

interface SessionOptions {
  id?: string;
  ageMs?: number;
  paymentStatus?: string;
  paymentType?: string | null;
  intent?: unknown;
  contractId?: string;
}

const session = (options: SessionOptions = {}) => {
  const id = options.id ?? `cs_${randomUUID()}`;
  return {
    id,
    created: sec(NOW.getTime() - (options.ageMs ?? 5 * HOUR)),
    payment_status: options.paymentStatus ?? "paid",
    amount_total: AMOUNT,
    currency: "usd",
    customer_details: { email: "private@example.test", name: "Private Name" },
    customer_email: "private@example.test",
    metadata: {
      ...(options.paymentType === null
        ? {}
        : { paymentType: options.paymentType ?? "CONTRACT_MILESTONE" }),
      ...(options.contractId ? { contractId: options.contractId } : {}),
    },
    payment_intent:
      options.intent === undefined
        ? {
            id: `pi_${id}`,
            amount_received: AMOUNT,
            latest_charge: { amount_refunded: 0 },
          }
        : options.intent,
  };
};

const page = (data: unknown[], hasMore = false) => ({
  data,
  has_more: hasMore,
});

const seedMilestone = async (sessionId: string) => {
  const authId = `${PREFIX}${randomUUID()}`;
  const ownerId = `${PREFIX}${randomUUID()}`;
  for (const [id, role] of [
    [authId, "CLIENT"],
    [ownerId, "FREELANCER"],
  ] as const) {
    await db.insert(accounts).values({
      auth_id: id,
      email: `${id}@example.test`,
      role,
      identityVerified: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: authId,
      title: "Orphan job",
      description: "Orphan test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
      status: "PUBLISHED",
      milestones: [
        {
          id: randomUUID(),
          title: "First",
          budgetCents: AMOUNT,
          dueDate: "2026-12-01",
        },
      ],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: ownerId,
      sender_type: "FREELANCER",
      cover_letter: "orphan test",
      bid_amount_cents: AMOUNT,
      duration: "1 week",
      status: "INTERVIEWED",
    })
    .returning({ id: proposals.id });
  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: authId,
      freelancer_id: ownerId,
      title: "Orphan contract",
      total_amount_cents: AMOUNT,
      status: "PENDING",
    })
    .returning({ id: contracts.id });
  await db.insert(contract_milestones).values({
    contract_id: contract!.id,
    title: "Milestone 1",
    amount_cents: AMOUNT,
    due_date: "2026-12-01",
    position: 0,
    status: "PENDING",
    stripe_checkout_session_id: sessionId,
  });
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const tableSnapshot = async () =>
  JSON.stringify([
    (
      await pool.query(
        "select * from contracts where client_id like $1 order by id",
        [`${PREFIX}%`],
      )
    ).rows,
    (
      await pool.query(
        "select * from contract_milestones where stripe_checkout_session_id is not null order by id",
      )
    ).rows,
  ]);

const entries = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.map(
    (call) =>
      call[0] as {
        eventName: string;
        attributes?: Record<string, unknown>;
      },
  );

const detected = () =>
  [...entries(mocks.loggerWarn), ...entries(mocks.loggerError)].filter(
    (entry) => entry.eventName === "payment.orphan.detected",
  );

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.list.mockReset();
  mocks.writeCalls.length = 0;
  mocks.envState.stripeSecretKey = "sk_stripe_test";
  for (const mock of [mocks.loggerInfo, mocks.loggerWarn, mocks.loggerError]) {
    mock.mockReset().mockResolvedValue(undefined);
  }
  await purge();
});

describe("detection", () => {
  it("does not report a paid session that has a milestone row", async () => {
    const recorded = session();
    await seedMilestone(recorded.id);
    mocks.list.mockResolvedValueOnce(page([recorded]));

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ scanned: 1, orphans: 0, aborted: false });
    expect(detected()).toEqual([]);
  });

  it("warns for an orphan younger than 3 days", async () => {
    const orphan = session({ ageMs: 3 * DAY - 1000, contractId: "c-1" });
    mocks.list.mockResolvedValueOnce(page([orphan]));

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ orphans: 1, exhausted: 0 });
    expect(mocks.loggerError).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(detected()[0]!.attributes).toEqual({
      "stripe.checkout_session_id": orphan.id,
      "stripe.payment_intent_id": `pi_${orphan.id}`,
      "session.age_hours": 71,
      "payment.amount_cents": AMOUNT,
      "payment.currency": "usd",
      "contract.id": "c-1",
    });
  });

  it("logs an error with retries_exhausted at exactly 3 days", async () => {
    const orphan = session({ ageMs: 3 * DAY });
    mocks.list.mockResolvedValueOnce(page([orphan]));

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ orphans: 1, exhausted: 1 });
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(detected()[0]!.attributes).toEqual({
      "stripe.checkout_session_id": orphan.id,
      "stripe.payment_intent_id": `pi_${orphan.id}`,
      "session.age_hours": 72,
      "payment.amount_cents": AMOUNT,
      "payment.currency": "usd",
      "contract.id": null,
      retries_exhausted: true,
    });
  });

  it("asks Stripe for a 2 hour minimum age and a 4 day lookback", async () => {
    mocks.list.mockResolvedValueOnce(page([]));

    await detectOrphanPaidSessions({ now: NOW });

    expect(mocks.list).toHaveBeenCalledWith({
      created: {
        gte: sec(NOW.getTime() - 4 * DAY),
        lte: sec(NOW.getTime() - 2 * HOUR),
      },
      status: "complete",
      limit: 100,
      expand: ["data.payment_intent.latest_charge"],
    });
  });

  it("ignores unpaid and non-contract sessions", async () => {
    mocks.list.mockResolvedValueOnce(
      page([
        session({ paymentStatus: "unpaid" }),
        session({ paymentStatus: "no_payment_required" }),
        session({ paymentType: "CONNECTS_PURCHASE" }),
        session({ paymentType: null }),
      ]),
    );

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ scanned: 0, orphans: 0 });
    expect(detected()).toEqual([]);
    expect(mocks.loggerInfo).not.toHaveBeenCalled();
  });

  it("reports funding sessions too", async () => {
    mocks.list.mockResolvedValueOnce(
      page([session({ paymentType: "CONTRACT_MILESTONE_FUNDING" })]),
    );

    expect(await detectOrphanPaidSessions({ now: NOW })).toMatchObject({
      orphans: 1,
    });
  });

  it("counts a fully refunded orphan as alreadyRefunded and does not report it", async () => {
    const refunded = session({
      intent: {
        id: "pi_r",
        amount_received: AMOUNT,
        latest_charge: { amount_refunded: AMOUNT },
      },
    });
    mocks.list.mockResolvedValueOnce(page([refunded]));

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ alreadyRefunded: 1, orphans: 0 });
    expect(detected()).toEqual([]);
  });

  it("reports a partially refunded orphan", async () => {
    mocks.list.mockResolvedValueOnce(
      page([
        session({
          intent: {
            id: "pi_p",
            amount_received: AMOUNT,
            latest_charge: { amount_refunded: AMOUNT - 1 },
          },
        }),
      ]),
    );

    expect(await detectOrphanPaidSessions({ now: NOW })).toMatchObject({
      orphans: 1,
      alreadyRefunded: 0,
    });
  });

  it("reports a session whose intent is an unexpanded id", async () => {
    mocks.list.mockResolvedValueOnce(page([session({ intent: "pi_string" })]));

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toMatchObject({ orphans: 1, alreadyRefunded: 0 });
    expect(detected()[0]!.attributes!["stripe.payment_intent_id"]).toBe(
      "pi_string",
    );
  });

  it("reports a session whose latest charge is an unexpanded id", async () => {
    mocks.list.mockResolvedValueOnce(
      page([
        session({
          intent: {
            id: "pi_c",
            amount_received: AMOUNT,
            latest_charge: "ch_string",
          },
        }),
      ]),
    );

    expect(await detectOrphanPaidSessions({ now: NOW })).toMatchObject({
      orphans: 1,
      alreadyRefunded: 0,
    });
  });

  it("reports a session with no payment intent and a null id", async () => {
    mocks.list.mockResolvedValueOnce(page([session({ intent: null })]));

    await detectOrphanPaidSessions({ now: NOW });

    expect(detected()[0]!.attributes!["stripe.payment_intent_id"]).toBeNull();
  });
});

describe("pagination and queries", () => {
  it("follows starting_after across pages with one lookup per page", async () => {
    const first = [session(), session()];
    const second = [session()];
    mocks.list
      .mockResolvedValueOnce(page(first, true))
      .mockResolvedValueOnce(page(second));
    const spy = vi.spyOn(pool, "query");

    const summary = await detectOrphanPaidSessions({ now: NOW });

    const lookups = spy.mock.calls.filter((call) => {
      const first = call[0] as unknown;
      const text =
        typeof first === "string" ? first : (first as { text?: string }).text;
      return String(text).includes("contract_milestones");
    });
    spy.mockRestore();
    expect(lookups).toHaveLength(2);
    expect(summary).toMatchObject({ scanned: 3, orphans: 3, aborted: false });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.calls[1]![0]).toMatchObject({
      starting_after: first[1]!.id,
    });
    expect(mocks.list.mock.calls[0]![0]).not.toHaveProperty("starting_after");
  });

  it("stops at the page cap, sets aborted and logs one truncated warning", async () => {
    mocks.list.mockImplementation(async () => page([session()], true));

    const summary = await detectOrphanPaidSessions({ now: NOW, maxPages: 3 });

    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ scanned: 3, aborted: true });
    const truncated = entries(mocks.loggerWarn).filter(
      (entry) => entry.eventName === "payment.orphan.truncated",
    );
    expect(truncated).toHaveLength(1);
    expect(entries(mocks.loggerInfo).map((e) => e.eventName)).toEqual([
      "payment.orphan.run",
    ]);
  });

  it("does not abort when the last allowed page has no more results", async () => {
    mocks.list
      .mockResolvedValueOnce(page([session()], true))
      .mockResolvedValueOnce(page([session()]));

    const summary = await detectOrphanPaidSessions({ now: NOW, maxPages: 2 });

    expect(summary.aborted).toBe(false);
  });

  it("defaults the page cap to 20", async () => {
    mocks.list.mockImplementation(async () => page([session()], true));

    await detectOrphanPaidSessions({ now: NOW });

    expect(mocks.list).toHaveBeenCalledTimes(20);
  });

  it("skips the lookup when a page has no candidates", async () => {
    mocks.list.mockResolvedValueOnce(
      page([session({ paymentStatus: "unpaid" })]),
    );
    const spy = vi.spyOn(pool, "query");

    await detectOrphanPaidSessions({ now: NOW });

    const count = spy.mock.calls.length;
    spy.mockRestore();
    expect(count).toBe(0);
  });
});

describe("safety", () => {
  it("logs no customer or card fields", async () => {
    mocks.list.mockResolvedValueOnce(
      page([session({ ageMs: 4 * DAY - HOUR }), session()]),
    );

    await detectOrphanPaidSessions({ now: NOW });

    const everything = JSON.stringify([
      mocks.loggerInfo.mock.calls,
      mocks.loggerWarn.mock.calls,
      mocks.loggerError.mock.calls,
    ]);
    expect(everything).not.toContain("private@example.test");
    expect(everything).not.toContain("Private Name");
    expect(detected()).toHaveLength(2);
    for (const entry of detected()) {
      expect(Object.keys(entry.attributes!).sort()).toEqual(
        [
          "stripe.checkout_session_id",
          "stripe.payment_intent_id",
          "session.age_hours",
          "payment.amount_cents",
          "payment.currency",
          "contract.id",
          ...(entry.attributes!.retries_exhausted ? ["retries_exhausted"] : []),
        ].sort(),
      );
    }
  });

  it("makes no Stripe write call and no database write", async () => {
    await seedMilestone("cs_recorded");
    mocks.list.mockResolvedValueOnce(
      page([session({ id: "cs_recorded" }), session(), session()]),
    );
    const before = await tableSnapshot();

    await detectOrphanPaidSessions({ now: NOW });

    expect(mocks.writeCalls).toEqual([]);
    expect(await tableSnapshot()).toBe(before);
  });

  it("skips with one info log when the Stripe key is missing", async () => {
    mocks.envState.stripeSecretKey = undefined;

    const summary = await detectOrphanPaidSessions({ now: NOW });

    expect(summary).toEqual({
      scanned: 0,
      orphans: 0,
      exhausted: 0,
      alreadyRefunded: 0,
      aborted: false,
      skipped: "no-stripe-key",
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("lets a Stripe failure propagate to the caller", async () => {
    mocks.list.mockRejectedValueOnce(new Error("boom"));

    await expect(detectOrphanPaidSessions({ now: NOW })).rejects.toThrow(
      "boom",
    );
  });

  it("logs one run summary only when something was scanned", async () => {
    mocks.list.mockResolvedValueOnce(page([]));
    await detectOrphanPaidSessions({ now: NOW });
    expect(mocks.loggerInfo).not.toHaveBeenCalled();

    mocks.list.mockResolvedValueOnce(page([session()]));
    await detectOrphanPaidSessions({ now: NOW });
    expect(entries(mocks.loggerInfo)).toHaveLength(1);
    expect(entries(mocks.loggerInfo)[0]).toMatchObject({
      eventName: "payment.orphan.run",
      attributes: {
        "orphan.scanned": 1,
        "orphan.orphans": 1,
        "orphan.exhausted": 0,
        "orphan.already_refunded": 0,
        "orphan.aborted": false,
      },
    });
  });
});
