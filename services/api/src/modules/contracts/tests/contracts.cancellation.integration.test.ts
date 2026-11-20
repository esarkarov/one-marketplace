import { randomUUID } from "node:crypto";
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
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  sendNotification: vi.fn(),
  pushNotice: vi.fn(),
  failAfterInsert: false,
  emitConversationUpdate: vi.fn(),
  refundCreate: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      stripeSecretKey: "sk_stripe_test",
      clientDashboard: "http://localhost:3999",
    },
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

vi.mock("@/infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    refunds: { create: mocks.refundCreate },
    customers: { create: mocks.customersCreate },
    checkout: {
      sessions: {
        create: mocks.sessionsCreate,
        retrieve: mocks.sessionsRetrieve,
      },
    },
  },
}));

vi.mock("@/infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
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
    insertNotification: async (
      ...args: Parameters<typeof original.insertNotification>
    ) => {
      const row = await original.insertNotification(...args);
      if (mocks.failAfterInsert) throw new Error("injected failure");
      return row;
    },
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
  conversation_participants,
  conversations,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { expectNoClerkIds } from "@/test/support/clerk-id-scan.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { uuidV5 } from "@/shared/ids/uuid-v5.js";
import { contractsResponses } from "@/modules/contracts/responses/contracts.responses.js";
import { createContractCheckout } from "@/modules/contracts/services/contracts.checkout.service.js";
import {
  acceptContract,
  cancelPendingContract,
  finishContractWithReview,
} from "@/modules/contracts/services/contracts.lifecycle.service.js";
import { recordRefundWithNotice } from "@/modules/contracts/services/contracts.lifecycle.service.js";
import { markContractCancelledIfPending } from "@/modules/contracts/repositories/contracts.state.repository.js";

const { app } = await import("@/app.js");

const PREFIX = "contracts-cancel-it-";
const API = "/api/v1/contracts";
const AMOUNT = 20000;

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
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
  contractStatus?: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  agency?: boolean;
  paymentIntent?: string | null;
  sessionId?: string | null;
}

const seed = async (options: SeedOptions = {}) => {
  const contractStatus = options.contractStatus ?? "PENDING";
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
        overview: "cancellation test agency",
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
      title: "Cancellation job",
      description: "Cancellation test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
      status: "HIRED",
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
      cover_letter: "cancellation test",
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
      client_id: clientId,
      freelancer_id: agencyId ? null : ownerId,
      agency_id: agencyId,
      title: "Cancellation contract",
      total_amount_cents: AMOUNT,
      status: contractStatus,
      started_at: contractStatus === "ACTIVE" ? new Date() : null,
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
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    agencyId
      ? {
          conversation_id: conversation!.id,
          agency_id: agencyId,
          participant_type: "AGENCY",
        }
      : {
          conversation_id: conversation!.id,
          account_id: ownerId,
          participant_type: "FREELANCER",
        },
  ]);

  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: contract!.id,
      title: "Milestone 1",
      amount_cents: AMOUNT,
      due_date: "2026-12-01",
      position: 0,
      status: contractStatus === "ACTIVE" ? "ACTIVE" : "PENDING",
      funded_at: new Date(),
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntent,
    })
    .returning({ id: contract_milestones.id });

  return {
    clientId,
    ownerId,
    agencyId,
    jobId: job!.id,
    proposalId: proposal!.id,
    contractId: contract!.id,
    milestoneId: milestone!.id,
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
  await pool.query("delete from client_spents where client_id like $1", [like]);
  await pool.query(
    "delete from freelancer_earning where freelancer_id like $1",
    [like],
  );
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const rows = async (text: string, params: unknown[]) =>
  (await pool.query(text, params)).rows;

const noticeEventId = (fixture: Fixture) =>
  uuidV5(`contract-cancelled:${fixture.contractId}`);

const storedNotices = (fixture: Fixture) =>
  rows("select * from notifications where event_id = $1", [
    noticeEventId(fixture),
  ]);

const state = async (fixture: Fixture) => {
  const [contract] = await rows("select status from contracts where id = $1", [
    fixture.contractId,
  ]);
  const [job] = await rows("select status from job_posts where id = $1", [
    fixture.jobId,
  ]);
  const [proposal] = await rows("select status from proposals where id = $1", [
    fixture.proposalId,
  ]);
  const [milestone] = await rows(
    "select status, funded_at from contract_milestones where id = $1",
    [fixture.milestoneId],
  );
  return {
    contract: contract.status as string,
    job: job.status as string,
    proposal: proposal.status as string,
    milestone: milestone.status as string,
    funded: milestone.funded_at !== null,
  };
};

const counters = async (fixture: Fixture) =>
  JSON.stringify({
    client: await rows("select * from client_spents where client_id = $1", [
      fixture.clientId,
    ]),
    freelancer: await rows(
      "select * from freelancer_earning where freelancer_id = $1",
      [fixture.ownerId],
    ),
    agency: fixture.agencyId
      ? await rows("select * from agency_earning where agency_id = $1", [
          fixture.agencyId,
        ])
      : [],
  });

const decline = (contractId: string, userId: string, scope?: "agency") =>
  request(app)
    .patch(`${API}/${contractId}/decline`)
    .query({ role: "freelancer", ...(scope ? { scope } : {}) })
    .set(as(userId));

const withdraw = (contractId: string, userId: string) =>
  request(app)
    .patch(`${API}/${contractId}/withdraw`)
    .query({ role: "client" })
    .set(as(userId));

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
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.getUser.mockResolvedValue({
    firstName: "Test",
    lastName: "User",
    imageUrl: "https://example.test/avatar.png",
  });
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.refundCreate.mockResolvedValue({ id: "re_test", status: "succeeded" });
  mocks.loggerWarn.mockResolvedValue(undefined);
  mocks.loggerError.mockResolvedValue(undefined);
  mocks.customersCreate.mockResolvedValue({ id: "cus_new" });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://stripe.test/pay" });
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.pushNotice.mockResolvedValue(undefined);
});

describe("PATCH /contracts/:contractId/decline", () => {
  it("refunds once, cancels, releases the job and notifies the client", async () => {
    const fixture = await seed();
    const before = await counters(fixture);

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    contractsResponses.decline[200].parse(response.body);
    expect(response.body.data).toEqual({
      contractId: fixture.contractId,
      status: "CANCELLED",
    });
    expectNoClerkIds(response.body, [fixture.clientId, fixture.ownerId]);

    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      {
        payment_intent: fixture.paymentIntent,
        reason: "requested_by_customer",
      },
      {
        idempotencyKey: `refund:${fixture.paymentIntent}:requested_by_customer`,
      },
    );
    expect(await state(fixture)).toEqual({
      contract: "CANCELLED",
      job: "PUBLISHED",
      proposal: "INTERVIEWED",
      milestone: "PENDING",
      funded: true,
    });
    expect(await counters(fixture)).toBe(before);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.clientId,
        type: "CONTRACT_DECLINED",
      }),
    );
  });

  it("is an idempotent 200 on retry that repeats the refund but not the notification", async () => {
    const fixture = await seed();
    await decline(fixture.contractId, fixture.ownerId);

    const again = await decline(fixture.contractId, fixture.ownerId);

    expect(again.status).toBe(200);
    contractsResponses.decline[200].parse(again.body);
    expect(again.body.message).toBe("Contract cancelled.");
    expect(again.body.data.status).toBe("CANCELLED");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(2);
    expect(mocks.refundCreate.mock.calls[1]).toEqual(
      mocks.refundCreate.mock.calls[0],
    );
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });

  it("answers 409 CONTRACT_NOT_PENDING for active and completed contracts", async () => {
    for (const contractStatus of ["ACTIVE", "COMPLETED"] as const) {
      const fixture = await seed({ contractStatus });
      const response = await decline(fixture.contractId, fixture.ownerId);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("CONTRACT_NOT_PENDING");
      contractsResponses.decline[409].parse(response.body);
      expect(mocks.refundCreate).not.toHaveBeenCalled();
      const after = await state(fixture);
      expect(after.contract).toBe(contractStatus);
      expect(after.job).toBe("HIRED");
    }
  });

  it("answers 404 for an unknown contract and for another freelancer", async () => {
    const fixture = await seed();
    const stranger = await insertAccount("FREELANCER");

    const unknown = await decline(randomUUID(), fixture.ownerId);
    expect(unknown.status).toBe(404);
    contractsResponses.decline[404].parse(unknown.body);

    const other = await decline(fixture.contractId, stranger);
    expect(other.status).toBe(404);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect((await state(fixture)).contract).toBe("PENDING");
  });

  it("answers 403 for the client role", async () => {
    const fixture = await seed();
    const response = await request(app)
      .patch(`${API}/${fixture.contractId}/decline`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(403);
    expect((await state(fixture)).contract).toBe("PENDING");
  });

  it("does not require identity verification", async () => {
    const fixture = await seed();
    await db
      .update(accounts)
      .set({ identityVerified: false })
      .where(eq(accounts.auth_id, fixture.ownerId));

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });

  it("applies the agency contract.accept permission", async () => {
    const fixture = await seed({ agency: true });
    const member = await insertAccount("FREELANCER");
    await db.insert(agency_members).values({
      agency_id: fixture.agencyId!,
      freelancer_id: member,
      role: "Agency member",
    });

    const denied = await decline(fixture.contractId, member, "agency");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("AGENCY_PERMISSION_DENIED");
    contractsResponses.decline[403].parse(denied.body);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect((await state(fixture)).contract).toBe("PENDING");

    const allowed = await decline(
      fixture.contractId,
      fixture.ownerId,
      "agency",
    );
    expect(allowed.status).toBe(200);
    expect((await state(fixture)).contract).toBe("CANCELLED");
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.clientId,
        type: "CONTRACT_DECLINED",
      }),
    );
  });
});

describe("PATCH /contracts/:contractId/withdraw", () => {
  it("refunds once, cancels, releases the job and notifies the talent", async () => {
    const fixture = await seed();
    const before = await counters(fixture);

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    contractsResponses.withdraw[200].parse(response.body);
    expect(response.body.data.status).toBe("CANCELLED");
    expectNoClerkIds(response.body, [fixture.clientId, fixture.ownerId]);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      {
        payment_intent: fixture.paymentIntent,
        reason: "requested_by_customer",
      },
      {
        idempotencyKey: `refund:${fixture.paymentIntent}:requested_by_customer`,
      },
    );
    expect(await state(fixture)).toEqual({
      contract: "CANCELLED",
      job: "PUBLISHED",
      proposal: "INTERVIEWED",
      milestone: "PENDING",
      funded: true,
    });
    expect(await counters(fixture)).toBe(before);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.ownerId,
        type: "CONTRACT_WITHDRAWN",
      }),
    );
  });

  it("notifies the agency when the contract belongs to one", async () => {
    const fixture = await seed({ agency: true });
    const response = await withdraw(fixture.contractId, fixture.clientId);
    expect(response.status).toBe(200);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: fixture.agencyId,
        type: "CONTRACT_WITHDRAWN",
      }),
    );
  });

  it("is an idempotent 200 on retry and after a decline, with a neutral message", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);
    const again = await withdraw(fixture.contractId, fixture.clientId);
    expect(again.status).toBe(200);
    expect(again.body.message).toBe("Contract cancelled.");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(2);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);

    mocks.refundCreate.mockClear();
    mocks.pushNotice.mockClear();
    const other = await seed();
    await decline(other.contractId, other.ownerId);
    const afterDecline = await withdraw(other.contractId, other.clientId);
    expect(afterDecline.status).toBe(200);
    expect(afterDecline.body.message).toBe("Contract cancelled.");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(2);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it("answers 409 CONTRACT_NOT_PENDING for active and completed contracts", async () => {
    for (const contractStatus of ["ACTIVE", "COMPLETED"] as const) {
      const fixture = await seed({ contractStatus });
      const response = await withdraw(fixture.contractId, fixture.clientId);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("CONTRACT_NOT_PENDING");
      contractsResponses.withdraw[409].parse(response.body);
      expect(mocks.refundCreate).not.toHaveBeenCalled();
      expect((await state(fixture)).job).toBe("HIRED");
    }
  });

  it("answers 404 for unknown contracts and other clients, 403 for talent", async () => {
    const fixture = await seed();
    const otherClient = await insertAccount("CLIENT");

    const unknown = await withdraw(randomUUID(), fixture.clientId);
    expect(unknown.status).toBe(404);
    contractsResponses.withdraw[404].parse(unknown.body);

    const other = await withdraw(fixture.contractId, otherClient);
    expect(other.status).toBe(404);

    const talent = await request(app)
      .patch(`${API}/${fixture.contractId}/withdraw`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));
    expect(talent.status).toBe(403);
    contractsResponses.withdraw[403].parse(talent.body);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect((await state(fixture)).contract).toBe("PENDING");
  });
});

describe("refund handling", () => {
  const cancelledState = {
    contract: "CANCELLED",
    job: "PUBLISHED",
    proposal: "INTERVIEWED",
    milestone: "PENDING",
    funded: true,
  };

  it("commits the cancellation before the refund call and holds no lock during it", async () => {
    const fixture = await seed();
    const observed: {
      status?: string;
      job?: string;
      lockFree?: boolean;
    } = {};
    mocks.refundCreate.mockImplementationOnce(async () => {
      observed.status = (
        await rows("select status from contracts where id = $1", [
          fixture.contractId,
        ])
      )[0]?.status;
      observed.job = (
        await rows("select status from job_posts where id = $1", [
          fixture.jobId,
        ])
      )[0]?.status;
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "select id from contracts where id = $1 for update nowait",
          [fixture.contractId],
        );
        observed.lockFree = true;
      } catch {
        observed.lockFree = false;
      } finally {
        await client.query("rollback");
        client.release();
      }
      return { id: "re_test", status: "succeeded" };
    });

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(observed).toEqual({
      status: "CANCELLED",
      job: "PUBLISHED",
      lockFree: true,
    });
  });

  it("keeps the cancellation when the refund fails and notifies nobody", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));

    const failed = await withdraw(fixture.contractId, fixture.clientId);

    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await state(fixture)).toEqual(cancelledState);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "payment.refund.failed" }),
    );
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
  });

  it("completes the refund on retry with the same key and sends the notification once", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));
    await decline(fixture.contractId, fixture.ownerId);

    const retry = await decline(fixture.contractId, fixture.ownerId);

    expect(retry.status).toBe(200);
    expect(retry.body.message).toBe("Contract cancelled.");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(2);
    expect(mocks.refundCreate.mock.calls[1]).toEqual(
      mocks.refundCreate.mock.calls[0],
    );
    expect(mocks.refundCreate.mock.calls[1]![1]).toEqual({
      idempotencyKey: `refund:${fixture.paymentIntent}:requested_by_customer`,
    });
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.clientId,
        type: "CONTRACT_DECLINED",
      }),
    );
    expect(await state(fixture)).toEqual(cancelledState);
  });

  it("treats charge_already_refunded as done on the first call and on retry", async () => {
    const alreadyRefunded = () =>
      Object.assign(new Error("already refunded"), {
        code: "charge_already_refunded",
      });

    const first = await seed();
    mocks.refundCreate.mockRejectedValueOnce(alreadyRefunded());
    const response = await decline(first.contractId, first.ownerId);
    expect(response.status).toBe(200);
    expect(await state(first)).toMatchObject(cancelledState);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);

    mocks.pushNotice.mockClear();
    const second = await seed();
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));
    await withdraw(second.contractId, second.clientId);
    mocks.refundCreate.mockRejectedValueOnce(alreadyRefunded());
    const retry = await withdraw(second.contractId, second.clientId);
    expect(retry.status).toBe(200);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it("derives the payment intent from the stored session", async () => {
    const fixture = await seed({ paymentIntent: null });
    mocks.sessionsRetrieve.mockResolvedValue({
      id: fixture.sessionId,
      payment_intent: "pi_from_session",
    });

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(mocks.sessionsRetrieve).toHaveBeenCalledWith(fixture.sessionId);
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_from_session", reason: "requested_by_customer" },
      { idempotencyKey: "refund:pi_from_session:requested_by_customer" },
    );
  });

  it("answers 502 and logs unavailable when no payment intent exists, then recovers on retry", async () => {
    const fixture = await seed({ paymentIntent: null });
    mocks.sessionsRetrieve.mockResolvedValueOnce({
      id: fixture.sessionId,
      payment_intent: null,
    });

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(502);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "payment.refund.unavailable" }),
    );
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(await state(fixture)).toMatchObject(cancelledState);

    mocks.sessionsRetrieve.mockResolvedValueOnce({
      id: fixture.sessionId,
      payment_intent: "pi_late",
    });
    const retry = await withdraw(fixture.contractId, fixture.clientId);
    expect(retry.status).toBe(200);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
  });

  it("does not fail the response when the notification cannot be published", async () => {
    const fixture = await seed();
    mocks.pushNotice.mockResolvedValue("failed");

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(await state(fixture)).toMatchObject(cancelledState);
  });
});

describe("races", () => {
  it("lets exactly one of accept and decline win and keeps refund and job consistent", async () => {
    for (let round = 0; round < 6; round += 1) {
      mocks.refundCreate.mockClear();
      const fixture = await seed();

      const results = await Promise.allSettled([
        acceptContract(fixture.contractId, fixture.ownerId),
        cancelPendingContract(fixture.contractId, {
          kind: "talent",
          freelancerId: fixture.ownerId,
        }),
      ]);

      const wins = results.filter((result) => result.status === "fulfilled");
      expect(wins).toHaveLength(1);
      const after = await state(fixture);
      if (results[0].status === "fulfilled") {
        expect(after.contract).toBe("ACTIVE");
        expect(after.job).toBe("HIRED");
        expect(mocks.refundCreate).not.toHaveBeenCalled();
        const loser = results[1] as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(ApiError);
        expect(loser.reason).toMatchObject({
          statusCode: 409,
          code: "CONTRACT_NOT_PENDING",
        });
      } else {
        expect(after.contract).toBe("CANCELLED");
        expect(after.job).toBe("PUBLISHED");
        expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
        const loser = results[0] as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(ApiError);
        expect(loser.reason).toMatchObject({ statusCode: 409 });
      }
    }
  });

  it("transitions once when decline and withdraw race and both refunds share one key", async () => {
    const fixture = await seed();

    const results = await Promise.all([
      cancelPendingContract(fixture.contractId, {
        kind: "talent",
        freelancerId: fixture.ownerId,
      }),
      cancelPendingContract(fixture.contractId, {
        kind: "client",
        clientId: fixture.clientId,
      }),
    ]);

    expect(results.filter((result) => !result.alreadyCancelled)).toHaveLength(
      1,
    );
    const keys = new Set(
      mocks.refundCreate.mock.calls.map(
        ([, options]) => options.idempotencyKey,
      ),
    );
    expect(keys).toEqual(
      new Set([`refund:${fixture.paymentIntent}:requested_by_customer`]),
    );
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });

  it("rejects accept after a committed cancellation even when the refund failed", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));
    const failed = await decline(fixture.contractId, fixture.ownerId);
    expect(failed.status).toBeGreaterThanOrEqual(500);

    const response = await request(app)
      .patch(`${API}/${fixture.contractId}/accept`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));

    expect(response.status).toBe(409);
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });

  it("rejects accept after cancellation", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);

    const response = await request(app)
      .patch(`${API}/${fixture.contractId}/accept`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));

    expect(response.status).toBe(409);
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });
});

describe("after cancellation", () => {
  it("blocks re-hiring the same proposal and allows another one", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);

    await expect(
      createContractCheckout(fixture.clientId, fixture.proposalId),
    ).rejects.toMatchObject({ statusCode: 409, code: "CONTRACT_EXISTS" });

    const [second] = await db
      .insert(proposals)
      .values({
        job_id: fixture.jobId,
        sender_id: await insertAccount("FREELANCER"),
        sender_type: "FREELANCER",
        cover_letter: "second candidate",
        bid_amount_cents: AMOUNT,
        duration: "1 week",
        status: "INTERVIEWED",
      })
      .returning({ id: proposals.id });

    await expect(
      createContractCheckout(fixture.clientId, second!.id),
    ).resolves.toBe("https://stripe.test/pay");
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("does not allow reviewing or finishing a cancelled contract", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);

    await expect(
      finishContractWithReview(
        fixture.contractId,
        fixture.clientId,
        "client",
        5,
        "Great work",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("lists the contract as CANCELLED for the client and the talent", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);

    const clientList = await request(app)
      .get(`${API}/client`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(clientList.status).toBe(200);
    contractsResponses.client[200].parse(clientList.body);
    expect(
      clientList.body.data.results.find(
        (item: { id: string }) => item.id === fixture.contractId,
      )?.status,
    ).toBe("CANCELLED");

    const talentList = await request(app)
      .get(`${API}/freelancer`)
      .query({ role: "freelancer" })
      .set(as(fixture.ownerId));
    expect(talentList.status).toBe(200);
    contractsResponses.freelancer[200].parse(talentList.body);
    expect(
      talentList.body.data.results.find(
        (item: { id: string }) => item.id === fixture.contractId,
      )?.status,
    ).toBe("CANCELLED");
  });
});

describe("markContractCancelledIfPending", () => {
  it("only cancels a pending contract", async () => {
    const pending = await seed();
    const active = await seed({ contractStatus: "ACTIVE" });

    expect(
      await markContractCancelledIfPending(
        db,
        active.contractId,
        new Date(),
        "TALENT",
      ),
    ).toHaveLength(0);
    expect((await state(active)).contract).toBe("ACTIVE");

    expect(
      await markContractCancelledIfPending(
        db,
        pending.contractId,
        new Date(),
        "TALENT",
      ),
    ).toHaveLength(1);
    expect(
      await markContractCancelledIfPending(
        db,
        pending.contractId,
        new Date(),
        "TALENT",
      ),
    ).toHaveLength(0);
    const [row] = await db
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, pending.contractId));
    expect(row?.status).toBe("CANCELLED");
  });
});

describe("decline and withdraw effects", () => {
  const detailsOf = async (fixture: Fixture) => {
    const [conversation] = await rows(
      "select c.id from conversations c join contracts k on k.proposal_id = c.proposal_id where k.id = $1",
      [fixture.contractId],
    );
    const [contract] = await rows("select title from contracts where id = $1", [
      fixture.contractId,
    ]);
    return {
      conversationId: conversation.id as string,
      title: contract.title as string,
    };
  };

  const watchCommit = (fixture: Fixture) => {
    const seen: string[] = [];
    mocks.emitConversationUpdate.mockImplementation(async () => {
      seen.push(`emit:${(await state(fixture)).contract}`);
    });
    mocks.pushNotice.mockImplementation(async () => {
      seen.push(`notify:${(await state(fixture)).contract}`);
    });
    return seen;
  };

  it("decline: refunds, then emits, then notifies the client, all after the commit", async () => {
    const fixture = await seed();
    const { conversationId, title } = await detailsOf(fixture);
    const seen = watchCommit(fixture);

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Contract offer declined.");
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      conversationId,
      fixture.ownerId,
    );
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      recipientId: fixture.clientId,
      type: "CONTRACT_DECLINED",
      title: "Contract offer declined",
      message: `Your offer for “${title}” was declined and your payment is being refunded.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
      eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
    });
    expect(mocks.refundCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emitConversationUpdate.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.emitConversationUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.pushNotice.mock.invocationCallOrder[0]!);
    expect(seen).toEqual(["emit:CANCELLED", "notify:CANCELLED"]);
  });

  it("decline: a failing push does not fail the request and keeps the cancellation, refund and stored notice", async () => {
    const fixture = await seed();
    mocks.pushNotice.mockRejectedValue(new Error("broker down"));

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect((await state(fixture)).contract).toBe("CANCELLED");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(await storedNotices(fixture)).toHaveLength(1);
  });

  it("decline: propagates a rejected emit as a 500 before any notification", async () => {
    const fixture = await seed();
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(500);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect((await state(fixture)).contract).toBe("CANCELLED");
  });

  it("withdraw: refunds, emits, then notifies the freelancer, all after the commit", async () => {
    const fixture = await seed();
    const { conversationId, title } = await detailsOf(fixture);
    const seen = watchCommit(fixture);

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Contract offer withdrawn.");
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      conversationId,
      fixture.clientId,
    );
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      recipientId: fixture.ownerId,
      type: "CONTRACT_WITHDRAWN",
      title: "Contract offer withdrawn",
      message: `The client withdrew the offer for “${title}”.`,
      link: `/messages?conversationId=${conversationId}`,
      metadata: { contractId: fixture.contractId },
      eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
    });
    expect(
      mocks.emitConversationUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.pushNotice.mock.invocationCallOrder[0]!);
    expect(seen).toEqual(["emit:CANCELLED", "notify:CANCELLED"]);
  });

  it("withdraw: notifies the agency with the same content", async () => {
    const fixture = await seed({ agency: true });
    const { conversationId, title } = await detailsOf(fixture);

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      agencyId: fixture.agencyId,
      type: "CONTRACT_WITHDRAWN",
      title: "Contract offer withdrawn",
      message: `The client withdrew the offer for “${title}”.`,
      link: `/messages?conversationId=${conversationId}`,
      metadata: { contractId: fixture.contractId },
      eventId: uuidV5(`contract-cancelled:${fixture.contractId}`),
    });
  });

  it("withdraw: a failing push does not fail the request and keeps the cancellation and stored notice", async () => {
    const fixture = await seed();
    mocks.pushNotice.mockRejectedValue(new Error("broker down"));

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    expect((await state(fixture)).contract).toBe("CANCELLED");
    expect(await storedNotices(fixture)).toHaveLength(1);
  });
});

describe("persisted cancel and refund facts", () => {
  const facts = async (fixture: Fixture) => {
    const [row] = await rows(
      "select cancelled_at, cancelled_by, refund_id, refunded_at from contracts where id = $1",
      [fixture.contractId],
    );
    return {
      cancelledAt: row.cancelled_at as Date | null,
      cancelledBy: row.cancelled_by as string | null,
      refundId: row.refund_id as string | null,
      refundedAt: row.refunded_at as Date | null,
    };
  };

  const alreadyRefunded = () =>
    Object.assign(new Error("already refunded"), {
      code: "charge_already_refunded",
    });

  const seedLegacyCancelled = async () => {
    const fixture = await seed({ contractStatus: "CANCELLED" });
    expect(await facts(fixture)).toEqual({
      cancelledAt: null,
      cancelledBy: null,
      refundId: null,
      refundedAt: null,
    });
    return fixture;
  };

  it("decline records cancelled_at and TALENT, then refunded_at and the refund id", async () => {
    const fixture = await seed();
    const before = Date.now();
    mocks.refundCreate.mockResolvedValueOnce({
      id: "re_decline",
      status: "succeeded",
    });

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    const recorded = await facts(fixture);
    expect(recorded.cancelledBy).toBe("TALENT");
    expect(recorded.cancelledAt!.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(recorded.refundId).toBe("re_decline");
    expect(recorded.refundedAt!.getTime()).toBeGreaterThanOrEqual(
      recorded.cancelledAt!.getTime(),
    );
  });

  it("agency decline records TALENT", async () => {
    const fixture = await seed({ agency: true });

    const response = await decline(
      fixture.contractId,
      fixture.ownerId,
      "agency",
    );

    expect(response.status).toBe(200);
    expect((await facts(fixture)).cancelledBy).toBe("TALENT");
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.clientId,
        type: "CONTRACT_DECLINED",
      }),
    );
  });

  it("withdraw records CLIENT and the refund facts", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockResolvedValueOnce({
      id: "re_withdraw",
      status: "succeeded",
    });

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    const recorded = await facts(fixture);
    expect(recorded.cancelledBy).toBe("CLIENT");
    expect(recorded.cancelledAt).not.toBeNull();
    expect(recorded.refundId).toBe("re_withdraw");
    expect(recorded.refundedAt).not.toBeNull();
  });

  it("keeps the first cancel facts when the other party repeats the call", async () => {
    const fixture = await seed();
    await decline(fixture.contractId, fixture.ownerId);
    const first = await facts(fixture);

    await withdraw(fixture.contractId, fixture.clientId);

    expect(await facts(fixture)).toEqual(first);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it("counts charge_already_refunded as done and stores no refund id", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValueOnce(alreadyRefunded());

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    const recorded = await facts(fixture);
    expect(recorded.refundedAt).not.toBeNull();
    expect(recorded.refundId).toBeNull();
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it("counts a pending refund as done", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockResolvedValueOnce({
      id: "re_pending",
      status: "pending",
    });

    const response = await withdraw(fixture.contractId, fixture.clientId);

    expect(response.status).toBe(200);
    const recorded = await facts(fixture);
    expect(recorded.refundId).toBe("re_pending");
    expect(recorded.refundedAt).not.toBeNull();
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "canceled"])(
    "treats a %s refund as a failure: no refunded_at, no notification, repaired on retry",
    async (status) => {
      const fixture = await seed();
      mocks.refundCreate.mockResolvedValueOnce({ id: "re_bad", status });

      const failed = await decline(fixture.contractId, fixture.ownerId);

      expect(failed.status).toBe(500);
      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "payment.refund.failed" }),
      );
      expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "payment.refunded" }),
      );
      const afterFailure = await facts(fixture);
      expect(afterFailure.cancelledBy).toBe("TALENT");
      expect(afterFailure.refundedAt).toBeNull();
      expect(afterFailure.refundId).toBeNull();
      expect(mocks.pushNotice).not.toHaveBeenCalled();
      expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();

      const retry = await decline(fixture.contractId, fixture.ownerId);

      expect(retry.status).toBe(200);
      expect((await facts(fixture)).refundedAt).not.toBeNull();
      expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    },
  );

  it("marks the refund of a legacy cancelled row without a notification or emit", async () => {
    const fixture = await seedLegacyCancelled();

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Contract cancelled.");
    const recorded = await facts(fixture);
    expect(recorded.refundedAt).not.toBeNull();
    expect(recorded.refundId).toBe("re_test");
    expect(recorded.cancelledBy).toBeNull();
    expect(recorded.cancelledAt).toBeNull();
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();

    const again = await withdraw(fixture.contractId, fixture.clientId);
    expect(again.status).toBe(200);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });

  it("sends nothing on a repeat after a fully successful first call", async () => {
    const fixture = await seed();
    await withdraw(fixture.contractId, fixture.clientId);
    const first = await facts(fixture);
    mocks.pushNotice.mockClear();
    mocks.emitConversationUpdate.mockClear();

    const repeat = await withdraw(fixture.contractId, fixture.clientId);

    expect(repeat.status).toBe(200);
    expect(await facts(fixture)).toEqual(first);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
  });

  it("sends exactly one notification when two repeat calls race after a failed refund", async () => {
    const fixture = await seed();
    mocks.refundCreate.mockRejectedValueOnce(new Error("stripe down"));
    const failed = await decline(fixture.contractId, fixture.ownerId);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect((await facts(fixture)).refundedAt).toBeNull();
    mocks.refundCreate.mockClear();

    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.refundCreate.mockImplementation(async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      return { id: "re_race", status: "succeeded" };
    });

    const results = await Promise.all([
      decline(fixture.contractId, fixture.ownerId),
      decline(fixture.contractId, fixture.ownerId),
    ]);

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(2);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect((await facts(fixture)).refundId).toBe("re_race");
  });

  it("recovers from a crash between the refund and the guarded update", async () => {
    const fixture = await seed();
    await pool.query(
      "update contracts set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'TALENT' where id = $1",
      [fixture.contractId],
    );
    await pool.query(
      "update job_posts set status = 'PUBLISHED' where id = $1",
      [fixture.jobId],
    );
    expect((await facts(fixture)).refundedAt).toBeNull();
    mocks.refundCreate.mockRejectedValueOnce(alreadyRefunded());

    const repeat = await decline(fixture.contractId, fixture.ownerId);

    expect(repeat.status).toBe(200);
    const recorded = await facts(fixture);
    expect(recorded.refundedAt).not.toBeNull();
    expect(recorded.refundId).toBeNull();
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: fixture.clientId,
        type: "CONTRACT_DECLINED",
      }),
    );
  });
});

describe("contracts cancel and refund checks", () => {
  const violation = async (text: string, params: unknown[]) => {
    try {
      await pool.query(text, params);
    } catch (error) {
      return (error as { constraint?: string }).constraint;
    }
    return undefined;
  };

  it("rejects refunded_at on a row that is not CANCELLED", async () => {
    for (const contractStatus of ["PENDING", "ACTIVE", "COMPLETED"] as const) {
      const fixture = await seed({ contractStatus });
      expect(
        await violation(
          "update contracts set refunded_at = now() where id = $1",
          [fixture.contractId],
        ),
      ).toBe("contracts_refunded_status_check");
    }
  });

  it("accepts refunded_at on a CANCELLED row", async () => {
    const fixture = await seed({ contractStatus: "CANCELLED" });
    expect(
      await violation(
        "update contracts set refunded_at = now() where id = $1",
        [fixture.contractId],
      ),
    ).toBeUndefined();
  });

  it("rejects half-set cancel facts in either direction", async () => {
    const fixture = await seed();
    expect(
      await violation(
        "update contracts set cancelled_at = now() where id = $1",
        [fixture.contractId],
      ),
    ).toBe("contracts_cancel_facts_check");
    expect(
      await violation(
        "update contracts set cancelled_by = 'CLIENT' where id = $1",
        [fixture.contractId],
      ),
    ).toBe("contracts_cancel_facts_check");
  });

  it("rejects an unknown cancelled_by and accepts both known values", async () => {
    const fixture = await seed();
    expect(
      await violation(
        "update contracts set cancelled_at = now(), cancelled_by = 'ADMIN' where id = $1",
        [fixture.contractId],
      ),
    ).toBe("contracts_cancelled_by_check");
    for (const by of ["CLIENT", "TALENT"]) {
      expect(
        await violation(
          "update contracts set cancelled_at = now(), cancelled_by = $2 where id = $1",
          [fixture.contractId, by],
        ),
      ).toBeUndefined();
    }
  });
});

describe("cancel notices stored in the refund transaction", () => {
  const alreadyRefunded = () =>
    Object.assign(new Error("already refunded"), {
      code: "charge_already_refunded",
    });

  beforeEach(() => {
    mocks.emitConversationUpdate.mockReset().mockResolvedValue(undefined);
    mocks.pushNotice.mockReset().mockResolvedValue(undefined);
    mocks.failAfterInsert = false;
  });

  const cancelDirectly = async (
    fixture: Fixture,
    cancelledBy: string | null,
    refundedAt = false,
  ) => {
    await pool.query(
      `update contracts set status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2,
         refunded_at = ${refundedAt ? "now()" : "null"} where id = $1`,
      [fixture.contractId, cancelledBy],
    );
  };

  const subject = (fixture: Fixture) => ({
    id: fixture.contractId,
    title: "Cancel job",
    conversationId: randomUUID(),
    clientId: fixture.clientId,
    freelancerId: fixture.ownerId,
    agencyId: null,
  });

  const refundedAt = async (fixture: Fixture) =>
    (
      await rows("select refunded_at from contracts where id = $1", [
        fixture.contractId,
      ])
    )[0].refunded_at as Date | null;

  it("decline stores the exact CONTRACT_DECLINED row, visible at push time, pushed once, with RabbitMQ untouched", async () => {
    const fixture = await seed();
    const visible: number[] = [];
    mocks.pushNotice.mockImplementation(async () => {
      visible.push((await storedNotices(fixture)).length);
    });

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    const [row] = await storedNotices(fixture);
    expect(row).toMatchObject({
      recipient_id: fixture.clientId,
      agency_id: null,
      type: "CONTRACT_DECLINED",
      title: "Contract offer declined",
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: { contractId: fixture.contractId },
    });
    expect(visible).toEqual([1]);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("a failure after the insert rolls back the notice and refunded_at", async () => {
    const fixture = await seed();
    await cancelDirectly(fixture, "TALENT");
    await pool.query(
      `create or replace function cancel_it_fail() returns trigger as $$ begin raise exception 'cancel_it_fail'; end; $$ language plpgsql`,
    );
    await pool.query(
      `create constraint trigger cancel_it_fail_trg after insert on notifications
         deferrable initially deferred for each row
         when (new.event_id = '${noticeEventId(fixture)}') execute function cancel_it_fail()`,
    );
    try {
      await expect(
        recordRefundWithNotice(subject(fixture), "re_1", new Date()),
      ).rejects.toThrow();
    } finally {
      await pool.query(
        "drop trigger if exists cancel_it_fail_trg on notifications",
      );
      await pool.query("drop function if exists cancel_it_fail()");
    }

    expect(await storedNotices(fixture)).toHaveLength(0);
    expect(await refundedAt(fixture)).toBeNull();
  });

  it("a failure right after the insert rolls back the notice and refunded_at", async () => {
    const fixture = await seed();
    await cancelDirectly(fixture, "TALENT");
    mocks.failAfterInsert = true;

    await expect(
      recordRefundWithNotice(subject(fixture), "re_2", new Date()),
    ).rejects.toThrow("injected failure");

    expect(await storedNotices(fixture)).toHaveLength(0);
    expect(await refundedAt(fixture)).toBeNull();
  });

  it("two concurrent winners produce one row and one winner", async () => {
    const fixture = await seed();
    await cancelDirectly(fixture, "TALENT");

    const results = await Promise.all([
      recordRefundWithNotice(subject(fixture), "re_a", new Date()),
      recordRefundWithNotice(subject(fixture), "re_b", new Date()),
    ]);

    expect(results.filter((result) => result.notifyFor)).toHaveLength(1);
    expect(results.filter((result) => result.notice)).toHaveLength(1);
    expect(await storedNotices(fixture)).toHaveLength(1);
  });

  it("a legacy row (cancelled_by NULL) records the refund and stores no notice", async () => {
    const fixture = await seed({ contractStatus: "CANCELLED" });

    const result = await recordRefundWithNotice(
      subject(fixture),
      "re_l",
      new Date(),
    );

    expect(result).toEqual({ notifyFor: null, notice: null });
    expect(await refundedAt(fixture)).not.toBeNull();
    expect(await storedNotices(fixture)).toHaveLength(0);
  });

  it("legacy crash window: refunded_at set without a row is not re-sent", async () => {
    const fixture = await seed();
    await cancelDirectly(fixture, "TALENT", true);
    mocks.refundCreate.mockRejectedValue(alreadyRefunded());

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(200);
    expect(await storedNotices(fixture)).toHaveLength(0);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });

  it("an emit that throws after the commit leaves the stored notice and refunded_at", async () => {
    const fixture = await seed();
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const response = await decline(fixture.contractId, fixture.ownerId);

    expect(response.status).toBe(500);
    expect(await storedNotices(fixture)).toHaveLength(1);
    expect(await refundedAt(fixture)).not.toBeNull();
  });

  it("a replay of the same decline keeps one row and one push", async () => {
    const fixture = await seed();

    await decline(fixture.contractId, fixture.ownerId);
    await decline(fixture.contractId, fixture.ownerId);

    expect(await storedNotices(fixture)).toHaveLength(1);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });
});
