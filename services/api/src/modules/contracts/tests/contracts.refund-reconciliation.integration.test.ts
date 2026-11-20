import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
  sendNotification: vi.fn(),
  pushNotice: vi.fn(),
  emitConversationUpdate: vi.fn(),
  refundCreate: vi.fn(),
  intentsRetrieve: vi.fn(),
  sessionsRetrieve: vi.fn(),
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

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    refunds: { create: mocks.refundCreate },
    paymentIntents: { retrieve: mocks.intentsRetrieve },
    checkout: { sessions: { retrieve: mocks.sessionsRetrieve } },
  },
}));

vi.mock(
  "@/infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

vi.mock("@/modules/notification-store/index.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/notification-store/index.js")
    >();
  return {
    ...original,
    pushStoredNotification: async (row: {
      event_id: string;
      recipient_id: string | null;
      agency_id: string | null;
      type: string;
      title: string;
      message: string;
      link: string | null;
      metadata: unknown;
    }) => {
      try {
        await mocks.pushNotice({
          ...(row.agency_id
            ? { agencyId: row.agency_id }
            : { recipientId: row.recipient_id }),
          type: row.type,
          title: row.title,
          message: row.message,
          link: row.link,
          metadata: row.metadata,
          eventId: row.event_id,
        });
      } catch {}
    },
  };
});

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "@/database/client.js";
import {
  accounts,
  agency_members,
  agency_metadata,
  contract_milestones,
  contracts,
  conversations,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { uuidV5 } from "@/shared/ids/uuid-v5.js";
import { withdrawOffer } from "@/modules/contracts/services/contracts.lifecycle.service.js";
import { claimRefundCandidates } from "@/modules/contracts/repositories/contracts.refund-reconciliation.repository.js";
import { reconcileCancelledContractRefunds } from "@/modules/contracts/services/contracts.refund-reconciliation.service.js";

const PREFIX = "contracts-refund-recon-it-";
const AMOUNT = 20000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    identityVerified: true,
    stripe_customer_id: role === "CLIENT" ? `cus_${randomUUID()}` : null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

interface SeedOptions {
  contractId?: string;
  status?: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  agency?: boolean;
  cancelledAt?: Date | null;
  cancelledBy?: "CLIENT" | "TALENT" | null;
  refundedAt?: Date | null;
  attempts?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  funded?: boolean;
  paymentIntent?: string | null;
  sessionId?: string | null;
}

const seed = async (options: SeedOptions = {}) => {
  const status = options.status ?? "CANCELLED";
  const cancelled = status === "CANCELLED";
  const cancelledAt =
    options.cancelledAt === undefined
      ? new Date(Date.now() - HOUR)
      : options.cancelledAt;
  const cancelledBy =
    options.cancelledBy === undefined ? "TALENT" : options.cancelledBy;
  const paymentIntent =
    options.paymentIntent === undefined
      ? `pi_${randomUUID()}`
      : options.paymentIntent;
  const sessionId =
    options.sessionId === undefined ? `cs_${randomUUID()}` : options.sessionId;

  const clientId = await insertAccount("CLIENT");
  const ownerId = await insertAccount("FREELANCER");
  let agencyId: string | null = null;
  if (options.agency) {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "refund reconciliation test agency",
      })
      .returning({ id: agency_metadata.id });
    agencyId = agency!.id;
    await db
      .insert(agency_members)
      .values({ agency_id: agencyId, freelancer_id: ownerId, role: "Founder" });
  }

  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Reconciliation job",
      description: "Reconciliation test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
      status: "PUBLISHED",
      milestones: [
        {
          id: randomUUID(),
          title: "First milestone",
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
      sender_id: agencyId ?? ownerId,
      sender_type: agencyId ? "AGENCY" : "FREELANCER",
      cover_letter: "reconciliation test",
      bid_amount_cents: AMOUNT,
      duration: "1 week",
      status: "INTERVIEWED",
    })
    .returning({ id: proposals.id });

  const title = `Reconciliation contract ${randomUUID().slice(0, 8)}`;
  const [contract] = await db
    .insert(contracts)
    .values({
      ...(options.contractId ? { id: options.contractId } : {}),
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: agencyId ? null : ownerId,
      agency_id: agencyId,
      title,
      total_amount_cents: AMOUNT,
      status,
      started_at: status === "ACTIVE" ? new Date() : null,
      cancelled_at: cancelled ? cancelledAt : null,
      cancelled_by: cancelled ? cancelledBy : null,
      refunded_at: cancelled ? (options.refundedAt ?? null) : null,
      refund_attempts: options.attempts ?? 0,
      refund_next_attempt_at: options.nextAttemptAt ?? null,
      refund_last_error: options.lastError ?? null,
    })
    .returning({ id: contracts.id });

  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });

  await db.insert(contract_milestones).values({
    contract_id: contract!.id,
    title: "Milestone 1",
    amount_cents: AMOUNT,
    due_date: "2026-12-01",
    position: 0,
    status: "PENDING",
    funded_at: options.funded === false ? null : new Date(),
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: paymentIntent,
  });

  return {
    clientId,
    ownerId,
    agencyId,
    proposalId: proposal!.id,
    contractId: contract!.id,
    conversationId: conversation!.id,
    title,
    paymentIntent,
    sessionId,
  };
};

type Fixture = Awaited<ReturnType<typeof seed>>;

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

interface ContractRow {
  status: string;
  refunded_at: Date | null;
  refund_id: string | null;
  refund_attempts: number;
  refund_next_attempt_at: Date | null;
  refund_last_error: string | null;
}

const rowOf = async (contractId: string): Promise<ContractRow> => {
  const { rows } = await pool.query(
    `select status, refunded_at, refund_id, refund_attempts,
            refund_next_attempt_at, refund_last_error
       from contracts where id = $1`,
    [contractId],
  );
  return rows[0];
};

const snapshot = async () =>
  JSON.stringify(
    (
      await pool.query(
        "select to_jsonb(c) as row from contracts c where client_id like $1 order by id",
        [`${PREFIX}%`],
      )
    ).rows,
  );

const intent = (refunded: boolean) => ({
  id: "pi_mock",
  amount_received: AMOUNT,
  latest_charge: { amount_refunded: refunded ? AMOUNT : 0 },
});

const stripeError = (
  type: string,
  extra: { code?: string; statusCode?: number } = {},
) =>
  Object.assign(new Error("Stripe said cus_secret_123 4242424242424242"), {
    type,
    ...extra,
  });

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const originalKey = (fixture: Fixture) =>
  `refund:${fixture.paymentIntent}:requested_by_customer`;

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
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function") mock.mockReset();
  }
  mocks.envState.stripeSecretKey = "sk_stripe_test";
  mocks.refundCreate.mockResolvedValue({ id: "re_test", status: "succeeded" });
  mocks.intentsRetrieve.mockImplementation(async () => intent(false));
  mocks.sessionsRetrieve.mockResolvedValue({ payment_intent: null });
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.pushNotice.mockResolvedValue(undefined);
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.loggerInfo.mockResolvedValue(undefined);
  mocks.loggerWarn.mockResolvedValue(undefined);
  mocks.loggerError.mockResolvedValue(undefined);
  await purge();
});

describe("legacy and already refunded rows", () => {
  it("marks a legacy row done without creating a refund, notice or emit when Stripe already refunded", async () => {
    const fixture = await seed({ cancelledAt: null, cancelledBy: null });
    mocks.intentsRetrieve.mockResolvedValue(intent(true));

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({
      scanned: 1,
      markedDone: 1,
      refunded: 0,
      detected: 0,
      aborted: false,
      skipped: null,
    });
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    const row = await rowOf(fixture.contractId);
    expect(row.refunded_at).toBeInstanceOf(Date);
    expect(row.refund_id).toBeNull();
    expect(row.refund_next_attempt_at).toBeNull();
    expect(row.refund_last_error).toBeNull();
  });

  it("marks a new row done and notifies once when Stripe already refunded", async () => {
    const fixture = await seed();
    mocks.intentsRetrieve.mockResolvedValue(intent(true));

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.markedDone).toBe(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect((await rowOf(fixture.contractId)).refund_id).toBeNull();
  });

  it("does not treat an uncaptured intent as refunded", async () => {
    await seed();
    mocks.intentsRetrieve.mockResolvedValue({
      id: "pi_mock",
      amount_received: 0,
      latest_charge: { amount_refunded: 0 },
    });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.markedDone).toBe(0);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
  });

  it("reads the latest charge expanded from the payment intent", async () => {
    const fixture = await seed();
    await reconcileCancelledContractRefunds({ mode: "on" });
    expect(mocks.intentsRetrieve).toHaveBeenCalledWith(fixture.paymentIntent, {
      expand: ["latest_charge"],
    });
  });
});

describe("refund creation", () => {
  it("uses the original key when cancelled less than 23 hours ago", async () => {
    const fixture = await seed({
      cancelledAt: new Date(Date.now() - 22 * HOUR),
      attempts: 3,
    });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.refunded).toBe(1);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      {
        payment_intent: fixture.paymentIntent,
        reason: "requested_by_customer",
      },
      { idempotencyKey: originalKey(fixture) },
    );
  });

  it("uses a recon-suffixed key with the claimed attempts when cancelled 23 hours ago or more", async () => {
    const older = await seed({
      cancelledAt: new Date(Date.now() - 30 * HOUR),
      attempts: 3,
    });
    await reconcileCancelledContractRefunds({ mode: "on" });
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      { payment_intent: older.paymentIntent, reason: "requested_by_customer" },
      { idempotencyKey: `${originalKey(older)}:recon:3` },
    );
  });

  it("uses the suffixed key for a legacy row without a cancel time", async () => {
    const legacy = await seed({ cancelledAt: null, cancelledBy: null });
    await reconcileCancelledContractRefunds({ mode: "on" });
    expect(mocks.refundCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: `${originalKey(legacy)}:recon:0`,
    });
  });

  it("switches to the suffixed key at exactly 23 hours", async () => {
    const now = new Date();
    const fixture = await seed({
      cancelledAt: new Date(now.getTime() - 23 * HOUR),
    });
    await reconcileCancelledContractRefunds({ mode: "on", now });
    expect(mocks.refundCreate).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: `${originalKey(fixture)}:recon:0`,
    });
  });

  it("records the refund id and clears the retry state on success", async () => {
    const fixture = await seed({
      attempts: 3,
      lastError: "card_declined",
      nextAttemptAt: new Date(Date.now() - HOUR),
    });
    mocks.refundCreate.mockResolvedValue({ id: "re_new", status: "succeeded" });

    await reconcileCancelledContractRefunds({ mode: "on" });

    const row = await rowOf(fixture.contractId);
    expect(row.refund_id).toBe("re_new");
    expect(row.refunded_at).toBeInstanceOf(Date);
    expect(row.refund_attempts).toBe(3);
    expect(row.refund_next_attempt_at).toBeNull();
    expect(row.refund_last_error).toBeNull();
  });

  it("counts a pending refund as done", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockResolvedValue({
      id: "re_pending",
      status: "pending",
    });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.refunded).toBe(1);
    const row = await rowOf(fixture.contractId);
    expect(row.refund_id).toBe("re_pending");
    expect(row.refunded_at).toBeInstanceOf(Date);
  });

  it("treats charge_already_refunded as done with no refund id", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValue(
      stripeError("StripeInvalidRequestError", {
        code: "charge_already_refunded",
      }),
    );

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({ refunded: 1, retriedLater: 0, parked: 0 });
    const row = await rowOf(fixture.contractId);
    expect(row.refunded_at).toBeInstanceOf(Date);
    expect(row.refund_id).toBeNull();
  });

  it.each(["failed", "canceled"])(
    "treats a %s refund as a failed attempt with backoff",
    async (status) => {
      const now = new Date();
      const fixture = await seed();
      mocks.refundCreate.mockResolvedValue({ id: "re_bad", status });

      const summary = await reconcileCancelledContractRefunds({
        mode: "on",
        now,
      });

      expect(summary).toMatchObject({ retriedLater: 1, refunded: 0 });
      const row = await rowOf(fixture.contractId);
      expect(row.refunded_at).toBeNull();
      expect(row.refund_id).toBeNull();
      expect(row.refund_attempts).toBe(1);
      expect(row.refund_last_error).toBe("RefundNotCompletedError");
      expect(row.refund_next_attempt_at?.getTime()).toBe(
        now.getTime() + 15 * MINUTE,
      );
      expect(mocks.pushNotice).not.toHaveBeenCalled();
    },
  );

  it("resolves the payment intent from the checkout session when none is stored", async () => {
    const fixture = await seed({ paymentIntent: null });
    mocks.sessionsRetrieve.mockResolvedValue({ payment_intent: "pi_session" });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.refunded).toBe(1);
    expect(mocks.sessionsRetrieve).toHaveBeenCalledWith(fixture.sessionId);
    expect(mocks.intentsRetrieve).toHaveBeenCalledWith("pi_session", {
      expand: ["latest_charge"],
    });
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_session", reason: "requested_by_customer" },
      { idempotencyKey: "refund:pi_session:requested_by_customer" },
    );
    expect(mocks.sessionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it("counts an unresolvable payment intent as a failed attempt", async () => {
    const fixture = await seed({ paymentIntent: null });
    mocks.sessionsRetrieve.mockResolvedValue({ payment_intent: null });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.retriedLater).toBe(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(1);
    expect(row.refund_last_error).toBe("PaymentIntentMissingError");
  });

  it("counts a claimed row without a conversation as a failed attempt", async () => {
    const fixture = await seed();
    await pool.query("delete from conversations where proposal_id = $1", [
      fixture.proposalId,
    ]);

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.scanned).toBe(1);
    expect(summary.retriedLater).toBe(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(1);
    expect(row.refund_last_error).toBe("ContractDetailsMissingError");
  });
});

describe("winner notifications", () => {
  it("notifies the client once for a talent decline, like the cancel path", async () => {
    const fixture = await seed({ cancelledBy: "TALENT" });

    await reconcileCancelledContractRefunds({ mode: "on" });

    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.ownerId,
    );
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      recipientId: fixture.clientId,
      type: "CONTRACT_DECLINED",
      title: "Contract offer declined",
      message: `Your offer for “${fixture.title}” was declined and your payment is being refunded.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
      eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
    });
  });

  it("notifies the freelancer once for a client withdrawal", async () => {
    const fixture = await seed({ cancelledBy: "CLIENT" });

    await reconcileCancelledContractRefunds({ mode: "on" });

    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.clientId,
    );
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      recipientId: fixture.ownerId,
      type: "CONTRACT_WITHDRAWN",
      title: "Contract offer withdrawn",
      message: `The client withdrew the offer for “${fixture.title}”.`,
      link: `/messages?conversationId=${fixture.conversationId}`,
      metadata: { contractId: fixture.contractId },
      eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
    });
  });

  it("notifies the agency for a client withdrawal of an agency contract", async () => {
    const fixture = await seed({ cancelledBy: "CLIENT", agency: true });

    await reconcileCancelledContractRefunds({ mode: "on" });

    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: fixture.agencyId,
        type: "CONTRACT_WITHDRAWN",
        eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
      }),
    );
  });

  it("does not repeat the notice on a second run", async () => {
    await seed();
    await reconcileCancelledContractRefunds({ mode: "on" });
    const second = await reconcileCancelledContractRefunds({ mode: "on" });
    expect(second.scanned).toBe(0);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps the recorded refund when the notice fails", async () => {
    const fixture = await seed();
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.refunded).toBe(1);
    expect((await rowOf(fixture.contractId)).refunded_at).toBeInstanceOf(Date);
    const stored = await pool.query(
      "select 1 from notifications where event_id = $1",
      [uuidV5(`contract-cancelled:${fixture.contractId}`)],
    );
    expect(stored.rows).toHaveLength(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "refund.reconcile.notify_failed" }),
    );
  });
});

describe("races with the cancel path", () => {
  it("sends exactly one notice when the cancel path records the refund first", async () => {
    const fixture = await seed({ cancelledBy: "CLIENT" });
    const gate = deferred();
    mocks.intentsRetrieve.mockImplementation(async () => {
      await gate.promise;
      return intent(false);
    });

    const reconciler = reconcileCancelledContractRefunds({ mode: "on" });
    await vi.waitFor(() => expect(mocks.intentsRetrieve).toHaveBeenCalled());
    await withdrawOffer(fixture.clientId, fixture.contractId);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);

    gate.resolve();
    await reconciler;

    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect((await rowOf(fixture.contractId)).refunded_at).toBeInstanceOf(Date);
  });

  it("sends exactly one notice when the reconciler records the refund first", async () => {
    const fixture = await seed({ cancelledBy: "CLIENT" });
    const gate = deferred();
    mocks.refundCreate.mockImplementationOnce(async () => {
      await gate.promise;
      return { id: "re_cancel_path", status: "succeeded" };
    });
    mocks.intentsRetrieve.mockResolvedValue(intent(true));

    const cancelPath = withdrawOffer(fixture.clientId, fixture.contractId);
    await vi.waitFor(() => expect(mocks.refundCreate).toHaveBeenCalled());
    const summary = await reconcileCancelledContractRefunds({ mode: "on" });
    expect(summary.markedDone).toBe(1);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);

    gate.resolve();
    await cancelPath;

    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect((await rowOf(fixture.contractId)).refund_id).toBeNull();
  });
});

describe("backoff and parking", () => {
  it.each([
    [0, 15 * MINUTE],
    [1, 30 * MINUTE],
    [5, 8 * HOUR],
    [12, 24 * HOUR],
  ])(
    "schedules the next attempt after %i earlier attempts in %i ms",
    async (attempts, delay) => {
      const now = new Date();
      const fixture = await seed({
        attempts,
        cancelledAt: new Date(now.getTime() - 48 * HOUR),
      });
      mocks.refundCreate.mockRejectedValue(
        stripeError("StripeInvalidRequestError", { code: "some_other_code" }),
      );

      const summary = await reconcileCancelledContractRefunds({
        mode: "on",
        now,
      });

      expect(summary).toMatchObject({ retriedLater: 1, parked: 0 });
      const row = await rowOf(fixture.contractId);
      expect(row.refund_attempts).toBe(attempts + 1);
      expect(row.refund_last_error).toBe("some_other_code");
      expect(row.refund_next_attempt_at?.getTime()).toBe(now.getTime() + delay);
    },
  );

  it("parks a row when its attempts reach 20", async () => {
    const fixture = await seed({ attempts: 19 });
    mocks.refundCreate.mockRejectedValue(
      stripeError("StripeInvalidRequestError", { code: "some_other_code" }),
    );

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({ parked: 1, retriedLater: 0 });
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(20);
    expect(row.refund_next_attempt_at).toBeNull();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "refund.reconcile.parked",
        attributes: {
          "contract.id": fixture.contractId,
          "error.code": "some_other_code",
        },
      }),
    );

    const again = await reconcileCancelledContractRefunds({ mode: "on" });
    expect(again.scanned).toBe(0);
  });

  it.each([
    "charge_not_refundable",
    "refund_disputed_payment",
    "resource_missing",
  ])("parks immediately on the permanent code %s", async (code) => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValue(
      stripeError("StripeInvalidRequestError", { code }),
    );

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({ parked: 1, retriedLater: 0 });
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(20);
    expect(row.refund_last_error).toBe(code);
    expect(row.refund_next_attempt_at).toBeNull();
    expect(row.refunded_at).toBeNull();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "refund.reconcile.parked",
        attributes: { "contract.id": fixture.contractId, "error.code": code },
      }),
    );
  });

  it("parks immediately when the payment intent read says resource_missing", async () => {
    const fixture = await seed();
    mocks.intentsRetrieve.mockRejectedValue(
      stripeError("StripeInvalidRequestError", {
        code: "resource_missing",
        statusCode: 404,
      }),
    );

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.parked).toBe(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect((await rowOf(fixture.contractId)).refund_attempts).toBe(20);
  });

  it("stores only a short sanitized tag, never the message body", async () => {
    const plain = await seed();
    mocks.refundCreate.mockRejectedValueOnce(
      new Error("customer cus_secret_123 card 4242"),
    );
    await reconcileCancelledContractRefunds({ mode: "on" });
    const plainRow = await rowOf(plain.contractId);
    expect(plainRow.refund_last_error).toBe("Error");

    const long = await seed();
    mocks.refundCreate.mockRejectedValueOnce(
      stripeError("StripeInvalidRequestError", { code: "x".repeat(300) }),
    );
    await reconcileCancelledContractRefunds({ mode: "on" });
    const longRow = await rowOf(long.contractId);
    expect(longRow.refund_last_error).toHaveLength(200);
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "cus_secret_123",
    );
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
      "cus_secret_123",
    );
  });
});

describe("Stripe unavailable", () => {
  it.each([
    ["a connection error", stripeError("StripeConnectionError")],
    ["a rate limit", stripeError("StripeRateLimitError", { statusCode: 429 })],
    ["a 5xx", stripeError("StripeAPIError", { statusCode: 503 })],
  ])(
    "consumes no attempt and releases the lease on %s",
    async (_name, error) => {
      const fixture = await seed({ attempts: 2 });
      mocks.intentsRetrieve.mockRejectedValue(error);

      const summary = await reconcileCancelledContractRefunds({ mode: "on" });

      expect(summary).toMatchObject({
        skippedStripeUnavailable: 1,
        retriedLater: 0,
        parked: 0,
        aborted: false,
      });
      const row = await rowOf(fixture.contractId);
      expect(row.refund_attempts).toBe(2);
      expect(row.refund_next_attempt_at).toBeNull();
      expect(row.refund_last_error).toBeNull();
      expect(mocks.refundCreate).not.toHaveBeenCalled();
    },
  );

  it("treats an unavailable refund call the same way", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValue(stripeError("StripeConnectionError"));

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.skippedStripeUnavailable).toBe(1);
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(0);
    expect(row.refund_next_attempt_at).toBeNull();
  });

  it("aborts after three consecutive failures and releases the remaining leases", async () => {
    const fixtures = [];
    for (let index = 0; index < 5; index += 1) fixtures.push(await seed());
    mocks.intentsRetrieve.mockRejectedValue(
      stripeError("StripeConnectionError"),
    );

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({
      scanned: 5,
      skippedStripeUnavailable: 3,
      aborted: true,
    });
    expect(mocks.intentsRetrieve).toHaveBeenCalledTimes(3);
    for (const fixture of fixtures) {
      const row = await rowOf(fixture.contractId);
      expect(row.refund_attempts).toBe(0);
      expect(row.refund_next_attempt_at).toBeNull();
    }
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "refund.reconcile.run" }),
    );
  });

  it("does not abort when a success interrupts the failures", async () => {
    for (let index = 0; index < 4; index += 1) await seed();
    const sequence = ["fail", "ok", "fail", "fail"];
    let call = 0;
    mocks.intentsRetrieve.mockImplementation(async () => {
      const step = sequence[call];
      call += 1;
      if (step === "fail") throw stripeError("StripeConnectionError");
      return intent(true);
    });

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({
      scanned: 4,
      skippedStripeUnavailable: 3,
      markedDone: 1,
      aborted: false,
    });
    expect(mocks.intentsRetrieve).toHaveBeenCalledTimes(4);
  });
});

describe("candidates", () => {
  it("ignores rows that are not candidates and picks the valid one", async () => {
    const now = new Date();
    const valid = await seed({ cancelledAt: new Date(now.getTime() - HOUR) });
    const ignored = {
      young: await seed({ cancelledAt: new Date(now.getTime() - 4 * MINUTE) }),
      futureRetry: await seed({
        nextAttemptAt: new Date(now.getTime() + MINUTE),
      }),
      parked: await seed({ attempts: 20 }),
      refunded: await seed({ refundedAt: new Date(now.getTime() - HOUR) }),
      pending: await seed({ status: "PENDING" }),
      active: await seed({ status: "ACTIVE" }),
      completed: await seed({ status: "COMPLETED" }),
      unfunded: await seed({ funded: false }),
      noPayment: await seed({ paymentIntent: null, sessionId: null }),
    };
    const before = new Map(
      await Promise.all(
        Object.values(ignored).map(
          async (fixture) =>
            [fixture.contractId, await rowOf(fixture.contractId)] as const,
        ),
      ),
    );

    const summary = await reconcileCancelledContractRefunds({
      mode: "on",
      now,
    });

    expect(summary).toMatchObject({ scanned: 1, refunded: 1 });
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate.mock.calls[0]?.[0]).toMatchObject({
      payment_intent: valid.paymentIntent,
    });
    for (const [contractId, row] of before) {
      expect(await rowOf(contractId)).toEqual(row);
    }
  });

  it("includes rows exactly 5 minutes old and due exactly now", async () => {
    const now = new Date();
    await seed({ cancelledAt: new Date(now.getTime() - 5 * MINUTE) });
    await seed({ nextAttemptAt: now });

    const summary = await reconcileCancelledContractRefunds({
      mode: "on",
      now,
    });

    expect(summary.scanned).toBe(2);
  });

  it("takes rows without a retry time first, then by retry time and id, and respects the limit", async () => {
    const now = new Date();
    const fresh = await seed();
    const older = await seed({
      nextAttemptAt: new Date(now.getTime() - 2 * HOUR),
    });
    const newer = await seed({
      nextAttemptAt: new Date(now.getTime() - HOUR),
    });

    const summary = await reconcileCancelledContractRefunds({
      mode: "on",
      now,
      limit: 2,
    });

    expect(summary.scanned).toBe(2);
    expect((await rowOf(fresh.contractId)).refunded_at).not.toBeNull();
    expect((await rowOf(older.contractId)).refunded_at).not.toBeNull();
    const left = await rowOf(newer.contractId);
    expect(left.refunded_at).toBeNull();
    expect(left.refund_next_attempt_at).toEqual(new Date(now.getTime() - HOUR));
  });

  it("defaults the limit to 50", async () => {
    mocks.intentsRetrieve.mockResolvedValue(intent(true));
    for (let index = 0; index < 52; index += 1) {
      await seed();
    }

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary.scanned).toBe(50);
    expect(summary.markedDone).toBe(50);
  }, 60_000);

  describe.each([
    { rows: 3, limit: 2 },
    { rows: 52, limit: 50 },
  ])(
    "claim under a nested loop plan with $rows rows and limit $limit",
    ({ rows, limit }) => {
      it("never claims more than the limit", async () => {
        for (let index = 0; index < rows; index += 1) {
          await seed({
            contractId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          });
        }
        const now = new Date();

        const claimed = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL enable_hashjoin = off`);
          await tx.execute(sql`SET LOCAL enable_mergejoin = off`);
          await tx.execute(sql`SET LOCAL enable_material = off`);
          await tx.execute(sql`SET LOCAL enable_hashagg = off`);
          await tx.execute(sql`SET LOCAL enable_sort = off`);
          return claimRefundCandidates(tx, {
            now,
            cancelledBefore: new Date(now.getTime() - 5 * MINUTE),
            maxAttempts: 20,
            limit,
            leaseUntil: new Date(now.getTime() + 10 * MINUTE),
          });
        });

        expect(claimed).toHaveLength(limit);
        expect(new Set(claimed.map((row) => row.id)).size).toBe(limit);
      }, 60_000);
    },
  );
});

describe("lease", () => {
  it("sets a ten minute lease on claimed rows and hides them from a second run", async () => {
    const now = new Date();
    const fixture = await seed();
    const gate = deferred();
    mocks.intentsRetrieve.mockImplementation(async () => {
      await gate.promise;
      return intent(false);
    });

    const first = reconcileCancelledContractRefunds({ mode: "on", now });
    await vi.waitFor(() => expect(mocks.intentsRetrieve).toHaveBeenCalled());

    const leased = await rowOf(fixture.contractId);
    expect(leased.refund_next_attempt_at?.getTime()).toBe(
      now.getTime() + 10 * MINUTE,
    );
    expect(leased.refund_attempts).toBe(0);
    const second = await reconcileCancelledContractRefunds({
      mode: "on",
      now,
    });
    expect(second.scanned).toBe(0);

    gate.resolve();
    await first;
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
  });

  it("never processes a row twice across concurrent runs", async () => {
    const fixtures = [];
    for (let index = 0; index < 8; index += 1) fixtures.push(await seed());
    mocks.intentsRetrieve.mockImplementation(async () => {
      await sleep(40);
      return intent(false);
    });

    const [a, b] = await Promise.all([
      reconcileCancelledContractRefunds({ mode: "on", limit: 8 }),
      reconcileCancelledContractRefunds({ mode: "on", limit: 8 }),
    ]);

    expect(a.scanned + b.scanned).toBe(8);
    expect(a.refunded + b.refunded).toBe(8);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(8);
    const intents = mocks.refundCreate.mock.calls.map(
      (call) => call[0].payment_intent,
    );
    expect(new Set(intents).size).toBe(8);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(8);
  });

  it("splits rows between concurrent runs with a small limit", async () => {
    for (let index = 0; index < 6; index += 1) await seed();
    mocks.intentsRetrieve.mockImplementation(async () => {
      await sleep(40);
      return intent(false);
    });

    const [a, b] = await Promise.all([
      reconcileCancelledContractRefunds({ mode: "on", limit: 3 }),
      reconcileCancelledContractRefunds({ mode: "on", limit: 3 }),
    ]);

    expect(a.scanned).toBe(3);
    expect(b.scanned).toBe(3);
    const intents = mocks.refundCreate.mock.calls.map(
      (call) => call[0].payment_intent,
    );
    expect(new Set(intents).size).toBe(6);
  });
});

describe("detect mode", () => {
  it("writes nothing and creates no refunds", async () => {
    await seed({ cancelledAt: null, cancelledBy: null });
    await seed({ attempts: 4, lastError: "x" });
    await seed({ cancelledAt: new Date(Date.now() - 30 * HOUR) });
    const refundedInStripe = await seed();
    mocks.intentsRetrieve.mockImplementation(async (id: string) =>
      intent(id === refundedInStripe.paymentIntent),
    );
    const before = await snapshot();

    const summary = await reconcileCancelledContractRefunds({ mode: "detect" });

    expect(summary).toMatchObject({
      scanned: 4,
      detected: 4,
      markedDone: 0,
      refunded: 0,
      retriedLater: 0,
      parked: 0,
    });
    expect(await snapshot()).toBe(before);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    const detected = mocks.loggerWarn.mock.calls.filter(
      ([entry]) => entry.eventName === "refund.reconcile.detected",
    );
    expect(detected).toHaveLength(4);
    for (const [entry] of detected) {
      expect(Object.keys(entry.attributes).sort()).toEqual([
        "contract.age_seconds",
        "contract.id",
      ]);
    }
  });

  it("writes nothing when Stripe is unavailable or fails", async () => {
    await seed();
    await seed();
    await seed();
    mocks.intentsRetrieve.mockRejectedValue(
      stripeError("StripeConnectionError"),
    );
    const before = await snapshot();

    const summary = await reconcileCancelledContractRefunds({ mode: "detect" });

    expect(summary).toMatchObject({
      skippedStripeUnavailable: 3,
      aborted: true,
    });
    expect(await snapshot()).toBe(before);

    mocks.intentsRetrieve.mockRejectedValue(
      stripeError("StripeInvalidRequestError", { code: "resource_missing" }),
    );
    const failed = await reconcileCancelledContractRefunds({ mode: "detect" });
    expect(failed).toMatchObject({ detected: 0, parked: 0, retriedLater: 0 });
    expect(await snapshot()).toBe(before);
  });
});

describe("run summary and Stripe configuration", () => {
  it("skips with one info log when the Stripe key is missing", async () => {
    await seed();
    mocks.envState.stripeSecretKey = undefined;
    const before = await snapshot();

    const summary = await reconcileCancelledContractRefunds({ mode: "on" });

    expect(summary).toMatchObject({ skipped: "no-stripe-key", scanned: 0 });
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1);
    expect(mocks.intentsRetrieve).not.toHaveBeenCalled();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await snapshot()).toBe(before);
  });

  it("logs one run line with the summary only when something was scanned", async () => {
    const empty = await reconcileCancelledContractRefunds({ mode: "on" });
    expect(empty.scanned).toBe(0);
    expect(mocks.loggerInfo).not.toHaveBeenCalled();

    await seed();
    await reconcileCancelledContractRefunds({ mode: "on" });
    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "refund.reconcile.run",
        attributes: expect.objectContaining({
          "refund.scanned": 1,
          "refund.refunded": 1,
        }),
      }),
    );
  });
});

describe("migration 0010", () => {
  it("rejects a negative attempts count and defaults new rows to zero", async () => {
    const fixture = await seed();
    const row = await rowOf(fixture.contractId);
    expect(row.refund_attempts).toBe(0);
    expect(row.refund_next_attempt_at).toBeNull();
    expect(row.refund_last_error).toBeNull();
    await expect(
      pool.query("update contracts set refund_attempts = -1 where id = $1", [
        fixture.contractId,
      ]),
    ).rejects.toMatchObject({ constraint: "contracts_refund_attempts_check" });
  });

  it("has the partial retry index", async () => {
    const { rows } = await pool.query(
      "select indexdef from pg_indexes where indexname = 'contracts_refund_retry_idx'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("refund_next_attempt_at");
    expect(rows[0].indexdef).toContain("CANCELLED");
    expect(rows[0].indexdef).toContain("refunded_at IS NULL");
  });
});
