import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
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
  sendNotification: vi.fn(),
  emitConversationUpdate: vi.fn(),
  refundCreate: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      stripeSecretKey: "sk_stripe_test",
      clientDashboard: "http://localhost:3999",
    },
  };
});

vi.mock("../../../config/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/logger.js")>();
  return {
    ...original,
    logger: {
      ...original.logger,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
    },
  };
});

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    refunds: { create: mocks.refundCreate },
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
  },
}));

vi.mock(
  "../../../infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

vi.mock("../../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "../../../database/client.js";
import {
  accounts,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  proposals,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { getFreelancerProposalMetadata } from "../../proposals/services/proposals.queries.service.js";
import {
  createContractCheckout,
  createMilestoneFundingCheckout,
  fundContractMilestoneFromPayment,
} from "../services/contracts.checkout.service.js";
import {
  acceptContract,
  createContractFromPayment,
} from "../services/contracts.lifecycle.service.js";

const PREFIX = "payment-recovery-";
const like = `${PREFIX}%`;
const FIRST = 1234;
const SECOND = 2500;

const purge = async () => {
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

beforeEach(async () => {
  await purge();
  vi.clearAllMocks();
  mocks.refundCreate.mockResolvedValue({ id: "re_test" });
  mocks.loggerWarn.mockResolvedValue(undefined);
  mocks.loggerError.mockResolvedValue(undefined);
  mocks.customersCreate.mockResolvedValue({ id: "cus_new" });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://stripe.test/pay" });
});

afterAll(async () => {
  await purge();
  await pool.end();
});

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    ...extra,
  });
  return authId;
};

const addProposal = async (
  clientId: string,
  jobId: string,
  status = "INTERVIEWED",
) => {
  const ownerId = await insertAccount("FREELANCER", { identityVerified: true });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: ownerId,
      sender_type: "FREELANCER",
      cover_letter: "recovery",
      bid_amount_cents: FIRST,
      duration: "1 week",
      status,
    })
    .returning({ id: proposals.id });
  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposal!.id,
      job_id: jobId,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    {
      conversation_id: conversation!.id,
      account_id: ownerId,
      participant_type: "FREELANCER",
    },
  ]);
  return { ownerId, proposalId: proposal!.id };
};

const seedOffer = async (jobStatus = "PUBLISHED") => {
  const customerId = `cus_${randomUUID()}`;
  const clientId = await insertAccount("CLIENT", {
    stripe_customer_id: customerId,
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Recovery job",
      description: "payment recovery",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: FIRST + SECOND,
      status: jobStatus,
      milestones: [
        {
          id: randomUUID(),
          title: "First",
          budgetCents: FIRST,
          dueDate: "2030-01-01",
        },
        {
          id: randomUUID(),
          title: "Second",
          budgetCents: SECOND,
          dueDate: "2030-02-01",
        },
      ],
    })
    .returning({ id: job_posts.id });
  const proposal = await addProposal(clientId, job!.id);
  return { clientId, customerId, jobId: job!.id, ...proposal };
};

type Offer = Awaited<ReturnType<typeof seedOffer>>;

const paymentSession = (
  offer: Offer,
  overrides: { amount?: number; id?: string; proposalId?: string } = {},
) => {
  const id = overrides.id ?? `cs_${randomUUID()}`;
  return {
    id,
    payment_status: "paid",
    payment_intent: `pi_${id}`,
    customer: offer.customerId,
    currency: "usd",
    amount_total: overrides.amount ?? FIRST,
    metadata: {
      paymentType: "CONTRACT_MILESTONE",
      proposalId: overrides.proposalId ?? offer.proposalId,
      jobId: offer.jobId,
      clientId: offer.clientId,
    },
  } as unknown as Stripe.Checkout.Session;
};

const fundingSession = (
  offer: Offer,
  contractId: string,
  milestoneId: string,
  amount = SECOND,
) => {
  const id = `cs_${randomUUID()}`;
  return {
    id,
    payment_status: "paid",
    payment_intent: `pi_${id}`,
    customer: offer.customerId,
    currency: "usd",
    amount_total: amount,
    metadata: {
      paymentType: "CONTRACT_MILESTONE_FUNDING",
      contractId,
      milestoneId,
      clientId: offer.clientId,
      requirements: "",
    },
  } as unknown as Stripe.Checkout.Session;
};

const readyForSecondFunding = async (contractId: string) => {
  await db
    .update(contract_milestones)
    .set({ status: "COMPLETED", completed_at: new Date() })
    .where(
      and(
        eq(contract_milestones.contract_id, contractId),
        eq(contract_milestones.position, 0),
      ),
    );
  const [second] = await db
    .select()
    .from(contract_milestones)
    .where(
      and(
        eq(contract_milestones.contract_id, contractId),
        eq(contract_milestones.position, 1),
      ),
    );
  return second!;
};

const jobStatusOf = async (jobId: string) =>
  (await db.select().from(job_posts).where(eq(job_posts.id, jobId)))[0]!.status;

const proposalStatusOf = async (proposalId: string) =>
  (await db.select().from(proposals).where(eq(proposals.id, proposalId)))[0]!
    .status;

const contractsOfJob = (jobId: string) =>
  db.select().from(contracts).where(eq(contracts.job_id, jobId));

const refundedWith = (
  session: Stripe.Checkout.Session,
  reason: "duplicate" | "requested_by_customer" = "duplicate",
) => [
  { payment_intent: session.payment_intent, reason },
  { idempotencyKey: `refund:${session.payment_intent}:${reason}` },
];

describe("job locking when the contract is created from payment", () => {
  it("marks the job HIRED with the contract and funded first milestone", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer);

    await createContractFromPayment(session);

    expect(await jobStatusOf(offer.jobId)).toBe("HIRED");
    const [contract] = await contractsOfJob(offer.jobId);
    expect(contract?.proposal_id).toBe(offer.proposalId);
    const milestones = await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.contract_id, contract!.id));
    expect(milestones).toHaveLength(2);
    expect(
      milestones.find((row) => row.position === 0)?.stripe_checkout_session_id,
    ).toBe(session.id);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("leaves everything unchanged and refunds nothing when the winning webhook is replayed", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer);

    await createContractFromPayment(session);
    await createContractFromPayment(session);

    expect(await jobStatusOf(offer.jobId)).toBe("HIRED");
    expect(await contractsOfJob(offer.jobId)).toHaveLength(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("refuses checkout for a proposal whose job is HIRED with JOB_ALREADY_HIRED", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const other = await addProposal(offer.clientId, offer.jobId);

    await expect(
      createContractCheckout(offer.clientId, other.proposalId),
    ).rejects.toMatchObject({ statusCode: 409, code: "JOB_ALREADY_HIRED" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("refunds a paid session for a second proposal on a HIRED job and creates no contract", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const other = await addProposal(offer.clientId, offer.jobId);
    const late = paymentSession(offer, { proposalId: other.proposalId });

    await createContractFromPayment(late);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(...refundedWith(late));
    const rows = await contractsOfJob(offer.jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposal_id).toBe(offer.proposalId);
    expect(await jobStatusOf(offer.jobId)).toBe("HIRED");
  });

  it("refunds and creates nothing when the job is not PUBLISHED at webhook time", async () => {
    const offer = await seedOffer("DRAFT");
    const session = paymentSession(offer);

    await createContractFromPayment(session);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
    expect(await jobStatusOf(offer.jobId)).toBe("DRAFT");
  });

  it("sets the proposal HIRED on acceptance and counts it as active", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const [contract] = await contractsOfJob(offer.jobId);
    expect(await proposalStatusOf(offer.proposalId)).toBe("INTERVIEWED");

    await acceptContract(contract!.id, offer.ownerId);

    expect(await proposalStatusOf(offer.proposalId)).toBe("HIRED");
    const metadata = await getFreelancerProposalMetadata(offer.ownerId);
    expect(metadata.counts).toMatchObject({
      total: 1,
      active: 1,
      interviewed: 0,
    });
    expect(metadata.proposals[0]).toMatchObject({ status: "HIRED" });
  });
});

describe("duplicate and mismatched payments", () => {
  it("refunds exactly once, with the idempotency key, a second session for the same proposal", async () => {
    const offer = await seedOffer();
    const winner = paymentSession(offer);
    const duplicate = paymentSession(offer);

    await createContractFromPayment(winner);
    await createContractFromPayment(duplicate);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(...refundedWith(duplicate));
    expect(await contractsOfJob(offer.jobId)).toHaveLength(1);
    const sessions = await pool.query<{ stripe_checkout_session_id: string }>(
      "select stripe_checkout_session_id from contract_milestones where stripe_checkout_session_id = any($1)",
      [[winner.id, duplicate.id]],
    );
    expect(sessions.rows.map((row) => row.stripe_checkout_session_id)).toEqual([
      winner.id,
    ]);
  });

  it("refunds one of two concurrent sessions for the same proposal and never the winner", async () => {
    const offer = await seedOffer();
    const a = paymentSession(offer);
    const b = paymentSession(offer);

    await Promise.all([
      createContractFromPayment(a),
      createContractFromPayment(b),
    ]);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    const refunded = mocks.refundCreate.mock.calls[0]![0].payment_intent;
    const winnerRow = await pool.query<{ stripe_checkout_session_id: string }>(
      "select stripe_checkout_session_id from contract_milestones where stripe_checkout_session_id = any($1)",
      [[a.id, b.id]],
    );
    expect(winnerRow.rows).toHaveLength(1);
    expect(refunded).not.toBe(
      `pi_${winnerRow.rows[0]!.stripe_checkout_session_id}`,
    );
  });

  it("refunds a second payment for an already funded milestone and not a replay of the funding session", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const [contract] = await contractsOfJob(offer.jobId);
    await acceptContract(contract!.id, offer.ownerId);
    const second = await readyForSecondFunding(contract!.id);
    const winner = fundingSession(offer, contract!.id, second.id);
    const duplicate = fundingSession(offer, contract!.id, second.id);

    await fundContractMilestoneFromPayment(winner);
    expect(mocks.refundCreate).not.toHaveBeenCalled();

    await fundContractMilestoneFromPayment(winner);
    expect(mocks.refundCreate).not.toHaveBeenCalled();

    await fundContractMilestoneFromPayment(duplicate);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(...refundedWith(duplicate));
  });

  it("logs, refunds and resolves when the amount does not match, creating nothing", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer, { amount: FIRST - 1 });

    await expect(createContractFromPayment(session)).resolves.toBeUndefined();

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      ...refundedWith(session, "requested_by_customer"),
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "payment.mismatch",
        attributes: expect.objectContaining({
          "stripe.checkout_session_id": session.id,
          "payment.expected_amount_cents": FIRST,
          "payment.amount_cents": FIRST - 1,
        }),
      }),
    );
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
    expect(await jobStatusOf(offer.jobId)).toBe("PUBLISHED");
  });

  it("refunds a mismatched milestone funding payment and leaves the milestone pending", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const [contract] = await contractsOfJob(offer.jobId);
    await acceptContract(contract!.id, offer.ownerId);
    const second = await readyForSecondFunding(contract!.id);
    const session = fundingSession(offer, contract!.id, second.id, SECOND + 1);

    await fundContractMilestoneFromPayment(session);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    const [after] = await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.id, second.id));
    expect(after!.status).toBe("PENDING");
  });

  it("returns silently without refunding when the session is not paid", async () => {
    const offer = await seedOffer();
    const session = {
      ...paymentSession(offer),
      payment_status: "unpaid",
    } as Stripe.Checkout.Session;

    await createContractFromPayment(session);

    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
  });

  it("logs and rethrows when the refund fails so Stripe retries the webhook", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer, { amount: FIRST + 1 });
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));

    await expect(createContractFromPayment(session)).rejects.toThrow(
      "stripe down",
    );

    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "payment.refund.failed" }),
    );
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
  });

  it("treats an already refunded charge as done", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer, { amount: FIRST + 1 });
    mocks.refundCreate.mockRejectedValueOnce(
      Object.assign(new Error("already refunded"), {
        code: "charge_already_refunded",
      }),
    );

    await expect(createContractFromPayment(session)).resolves.toBeUndefined();
  });
});

describe("unfulfillable payments", () => {
  const withoutIntent = (session: Stripe.Checkout.Session) =>
    ({
      ...session,
      payment_intent: null,
    }) as unknown as Stripe.Checkout.Session;

  const unfulfillableLogged = (
    session: Stripe.Checkout.Session,
    reason: string,
  ) =>
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "payment.unfulfillable",
        attributes: expect.objectContaining({
          "stripe.checkout_session_id": session.id,
          "stripe.payment_intent_id": session.payment_intent,
          "payment.unfulfillable_reason": reason,
        }),
      }),
    );

  const expectRefundedOnce = (session: Stripe.Checkout.Session) => {
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      ...refundedWith(session, "requested_by_customer"),
    );
  };

  const expectSameKeyOnReplay = async (
    run: () => Promise<void>,
    session: Stripe.Checkout.Session,
  ) => {
    await run();
    await run();
    const keys = mocks.refundCreate.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(new Set(keys)).toEqual(
      new Set([`refund:${session.payment_intent}:requested_by_customer`]),
    );
  };

  const unfulfillableContractCases = [
    [
      "the offer no longer exists",
      "offer_not_found",
      async (offer: Offer) =>
        paymentSession(offer, { proposalId: randomUUID() }),
    ],
    [
      "the proposal is no longer INTERVIEWED",
      "proposal_not_interviewed",
      async (offer: Offer) => {
        await db
          .update(proposals)
          .set({ status: "SUBMITTED" })
          .where(eq(proposals.id, offer.proposalId));
        return paymentSession(offer);
      },
    ],
    [
      "the job has no milestones",
      "milestones_invalid",
      async (offer: Offer) => {
        await db
          .update(job_posts)
          .set({ milestones: [] })
          .where(eq(job_posts.id, offer.jobId));
        return paymentSession(offer);
      },
    ],
    [
      "a milestone amount is zero",
      "milestones_invalid",
      async (offer: Offer) => {
        await db
          .update(job_posts)
          .set({
            milestones: [
              {
                id: randomUUID(),
                title: "Zero",
                budgetCents: 0,
                dueDate: "2030-01-01",
              },
            ],
          })
          .where(eq(job_posts.id, offer.jobId));
        return paymentSession(offer);
      },
    ],
    [
      "the first milestone no longer equals the amount paid",
      "amount_mismatch",
      async (offer: Offer) => {
        await db
          .update(job_posts)
          .set({
            milestones: [
              {
                id: randomUUID(),
                title: "Changed",
                budgetCents: FIRST + 100,
                dueDate: "2030-01-01",
              },
            ],
          })
          .where(eq(job_posts.id, offer.jobId));
        return paymentSession(offer);
      },
    ],
  ] as const;

  it.each(unfulfillableContractCases)(
    "refunds once, creates no contract and answers success when %s",
    async (_name, reason, prepare) => {
      const offer = await seedOffer();
      const session = await prepare(offer);

      await expect(createContractFromPayment(session)).resolves.toBeUndefined();

      expectRefundedOnce(session);
      unfulfillableLogged(session, reason);
      expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
      expect(await jobStatusOf(offer.jobId)).toBe("PUBLISHED");
    },
  );

  it.each(unfulfillableContractCases)(
    "replays a webhook where %s with the same idempotency key and no contract",
    async (_name, _reason, prepare) => {
      const offer = await seedOffer();
      const session = await prepare(offer);

      await expectSameKeyOnReplay(
        () => createContractFromPayment(session),
        session,
      );

      expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
    },
  );

  const fundingTarget = async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const [contract] = await contractsOfJob(offer.jobId);
    await acceptContract(contract!.id, offer.ownerId);
    const second = await readyForSecondFunding(contract!.id);
    return { offer, contract: contract!, second };
  };

  it("refunds once and answers success when the funded milestone does not exist", async () => {
    const { offer, contract } = await fundingTarget();
    const session = fundingSession(offer, contract.id, randomUUID());

    await expect(
      fundContractMilestoneFromPayment(session),
    ).resolves.toBeUndefined();

    expectRefundedOnce(session);
    unfulfillableLogged(session, "milestone_not_fundable");
  });

  it("refunds once and answers success when the milestone is not fundable, and keeps the same key on replay", async () => {
    const { offer, contract, second } = await fundingTarget();
    await db
      .update(contract_milestones)
      .set({ status: "COMPLETED", completed_at: new Date() })
      .where(eq(contract_milestones.id, second.id));
    const session = fundingSession(offer, contract.id, second.id);

    await expectSameKeyOnReplay(
      () => fundContractMilestoneFromPayment(session),
      session,
    );

    expect(mocks.refundCreate).toHaveBeenCalledWith(
      ...refundedWith(session, "requested_by_customer"),
    );
    unfulfillableLogged(session, "milestone_not_fundable");
  });

  it("does not refund or flag a replay of a successful contract webhook, even after acceptance", async () => {
    const offer = await seedOffer();
    const session = paymentSession(offer);
    await createContractFromPayment(session);
    const [contract] = await contractsOfJob(offer.jobId);
    await acceptContract(contract!.id, offer.ownerId);
    mocks.loggerError.mockClear();

    await createContractFromPayment(session);

    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
    expect(await contractsOfJob(offer.jobId)).toHaveLength(1);
  });

  it("keeps throwing and does not refund on a transient failure of the offer lookup", async () => {
    const offer = await seedOffer();
    const spy = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("connection reset");
    });

    await expect(
      createContractFromPayment(paymentSession(offer)),
    ).rejects.toThrow("connection reset");

    spy.mockRestore();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
  });

  it("keeps throwing and does not refund when the contract transaction fails", async () => {
    const offer = await seedOffer();
    const spy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("deadlock detected"));

    await expect(
      createContractFromPayment(paymentSession(offer)),
    ).rejects.toThrow("deadlock detected");

    spy.mockRestore();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await contractsOfJob(offer.jobId)).toHaveLength(0);
  });

  it("keeps throwing and does not refund when the funding transaction fails", async () => {
    const { offer, contract, second } = await fundingTarget();
    const spy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("deadlock detected"));

    await expect(
      fundContractMilestoneFromPayment(
        fundingSession(offer, contract.id, second.id),
      ),
    ).rejects.toThrow("deadlock detected");

    spy.mockRestore();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  const expectUnavailable = (session: Stripe.Checkout.Session) => {
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "payment.refund.unavailable",
        attributes: expect.objectContaining({
          "stripe.checkout_session_id": session.id,
        }),
      }),
    );
  };

  it("logs and answers success without refunding when the intent is missing on the duplicate path", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const duplicate = withoutIntent(paymentSession(offer));

    await expect(createContractFromPayment(duplicate)).resolves.toBeUndefined();

    expectUnavailable(duplicate);
  });

  it("logs and answers success without refunding when the intent is missing on the mismatch path", async () => {
    const offer = await seedOffer();
    const session = withoutIntent(paymentSession(offer, { amount: FIRST + 1 }));

    await expect(createContractFromPayment(session)).resolves.toBeUndefined();

    expectUnavailable(session);
  });

  it("logs and answers success without refunding when the intent is missing on the unfulfillable path", async () => {
    const offer = await seedOffer();
    await db
      .update(proposals)
      .set({ status: "SUBMITTED" })
      .where(eq(proposals.id, offer.proposalId));
    const session = withoutIntent(paymentSession(offer));

    await expect(createContractFromPayment(session)).resolves.toBeUndefined();

    expectUnavailable(session);
  });

  it("logs and answers success without refunding when the intent is missing for a funding payment", async () => {
    const { offer, contract } = await fundingTarget();
    const session = withoutIntent(
      fundingSession(offer, contract.id, randomUUID()),
    );

    await expect(
      fundContractMilestoneFromPayment(session),
    ).resolves.toBeUndefined();

    expectUnavailable(session);
  });
});

describe("checkout sessions", () => {
  it("answers 409 CONTRACT_EXISTS for a proposal that already has a contract", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));

    await expect(
      createContractCheckout(offer.clientId, offer.proposalId),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONTRACT_EXISTS" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a contract session expiring between 30 minutes and 24 hours, with a reference and no idempotency key", async () => {
    const offer = await seedOffer();
    const before = Math.floor(Date.now() / 1000);

    await createContractCheckout(offer.clientId, offer.proposalId);

    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const call = mocks.sessionsCreate.mock.calls[0]!;
    expect(call).toHaveLength(1);
    expect(call[0].client_reference_id).toBe(offer.proposalId);
    expect(call[0].expires_at).toBeGreaterThan(before + 30 * 60);
    expect(call[0].expires_at).toBeLessThan(before + 24 * 60 * 60);
  });

  it("creates a milestone funding session with the same expiry rules", async () => {
    const offer = await seedOffer();
    await createContractFromPayment(paymentSession(offer));
    const [contract] = await contractsOfJob(offer.jobId);
    await acceptContract(contract!.id, offer.ownerId);
    const second = await readyForSecondFunding(contract!.id);
    const before = Math.floor(Date.now() / 1000);

    await createMilestoneFundingCheckout(
      offer.clientId,
      contract!.id,
      second.id,
    );

    const call = mocks.sessionsCreate.mock.calls[0]!;
    expect(call).toHaveLength(1);
    expect(call[0].client_reference_id).toBe(second.id);
    expect(call[0].expires_at).toBeGreaterThan(before + 30 * 60);
    expect(call[0].expires_at).toBeLessThan(before + 24 * 60 * 60);
  });
});
