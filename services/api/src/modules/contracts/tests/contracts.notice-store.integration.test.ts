import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  push: vi.fn(),
  emit: vi.fn(),
  emitAgency: vi.fn(),
  warn: vi.fn(),
  failAfterInsert: false,
  emitThrows: false,
  visibleAtPush: [] as number[],
}));

vi.mock("@/config/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/logger.js")>();
  return { ...original, logger: { ...original.logger, warn: mocks.warn } };
});

vi.mock("@/infrastructure/payments/stripe.client.js", () => ({
  stripe: { refunds: { create: mocks.refundCreate } },
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

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

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
    pushStoredNotification: async (row: { event_id: string }) => {
      const visible = await pool.query(
        "select count(*)::int as c from notifications where event_id = $1",
        [row.event_id],
      );
      mocks.visibleAtPush.push(visible.rows[0].c);
      mocks.push(row);
      await original.pushStoredNotification(
        row as Parameters<typeof original.pushStoredNotification>[0],
      );
    },
  };
});

vi.mock(
  "@/modules/notifications/services/notifications.sse.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/modules/notifications/services/notifications.sse.js")
    >()),
    emitNotification: (...args: unknown[]) => {
      if (mocks.emitThrows) {
        throw Object.assign(new Error("secret detail"), { code: "EPIPE" });
      }
      mocks.emit(...args);
    },
    emitAgencyNotification: (...args: unknown[]) => {
      if (mocks.emitThrows) {
        throw Object.assign(new Error("secret detail"), { code: "EPIPE" });
      }
      mocks.emitAgency(...args);
    },
  }),
);

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
import { isRabbitEnabled } from "@/infrastructure/events/rabbitmq.client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";

(
  await import("@/modules/notifications/services/notifications.push.service.js")
).registerNotificationsPush();

const { createContractFromPayment } =
  await import("@/modules/contracts/services/contracts.lifecycle.service.js");
const { fundContractMilestoneFromPayment } =
  await import("@/modules/contracts/services/contracts.checkout.service.js");
const { submitMilestone, reviewMilestone } =
  await import("@/modules/contracts/services/contracts.milestones.service.js");
const { pushStoredNotification } =
  await import("@/modules/notification-store/index.js");

const PREFIX = "contracts-notice-it-";
const AMOUNT = 20000;
const JOB_TITLE = "Notice job";
const MILESTONE_TITLE = "Notice milestone";

type Owner = "freelancer" | "agency";
type ContractState = "none" | "pending" | "active" | "review";

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    display_name: "Test User",
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const seed = async (owner: Owner, contractState: ContractState) => {
  const clientId = await insertAccount("CLIENT");
  const ownerId = await insertAccount("FREELANCER");
  const customerId = `cus_it_${randomUUID()}`;
  await db
    .update(accounts)
    .set({ stripe_customer_id: customerId })
    .where(eq(accounts.auth_id, clientId));

  let agencyId: string | null = null;
  if (owner === "agency") {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "notice store agency",
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
      title: JOB_TITLE,
      description: "Notice store job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
      status: "PUBLISHED",
      milestones: [
        {
          id: randomUUID(),
          title: MILESTONE_TITLE,
          budgetCents: AMOUNT,
          dueDate: "2030-01-01",
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
      cover_letter: "notice store",
      bid_amount_cents: AMOUNT,
      duration: "1 week",
      status: "INTERVIEWED",
    })
    .returning({ id: proposals.id });

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

  let contractId: string | null = null;
  let milestoneId: string | null = null;
  if (contractState !== "none") {
    const [contract] = await db
      .insert(contracts)
      .values({
        proposal_id: proposal!.id,
        job_id: job!.id,
        client_id: clientId,
        freelancer_id: agencyId ? null : ownerId,
        agency_id: agencyId,
        title: "Notice contract",
        total_amount_cents: AMOUNT,
        status: "ACTIVE",
        started_at: new Date(),
      })
      .returning({ id: contracts.id });
    contractId = contract!.id;
    const [milestone] = await db
      .insert(contract_milestones)
      .values({
        contract_id: contractId,
        title: MILESTONE_TITLE,
        amount_cents: AMOUNT,
        due_date: "2030-01-01",
        position: 0,
        status: contractState === "pending" ? "PENDING" : "ACTIVE",
        funded_at: contractState === "pending" ? null : new Date(),
        payment_requested_at: contractState === "review" ? new Date() : null,
        submission_message: contractState === "review" ? "Work is ready" : null,
      })
      .returning({ id: contract_milestones.id });
    milestoneId = milestone!.id;
  }

  return {
    owner,
    clientId,
    ownerId,
    agencyId,
    customerId,
    jobId: job!.id,
    proposalId: proposal!.id,
    conversationId: conversation!.id,
    contractId,
    milestoneId,
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
  await pool.query("delete from notifications where recipient_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const contractIdOf = async (fixture: Fixture) =>
  (
    await pool.query("select id from contracts where proposal_id = $1", [
      fixture.proposalId,
    ])
  ).rows[0]?.id as string | undefined;

const probe = async (fixture: Fixture) =>
  JSON.stringify({
    contracts: (
      await pool.query(
        "select status from contracts where proposal_id = $1 order by id",
        [fixture.proposalId],
      )
    ).rows,
    milestones: (
      await pool.query(
        "select status, funded_at is not null as funded, payment_requested_at is not null as requested from contract_milestones where contract_id in (select id from contracts where proposal_id = $1) order by position",
        [fixture.proposalId],
      )
    ).rows,
    messages: (
      await pool.query(
        "select count(*)::int as c from messages where conversation_id = $1",
        [fixture.conversationId],
      )
    ).rows,
    earnings: (
      await pool.query(
        "select count(*)::int as c from earning_history where contract_id in (select id from contracts where proposal_id = $1)",
        [fixture.proposalId],
      )
    ).rows,
    job: (
      await pool.query("select status from job_posts where id = $1", [
        fixture.jobId,
      ])
    ).rows,
  });

const stored = async (fixture: Fixture, type: string) =>
  (
    await pool.query(
      `select event_id, recipient_id, agency_id, type, title, message, link, metadata
         from notifications
        where type = $1 and (recipient_id = any($2) or agency_id = $3)
        order by created_at, id`,
      [
        type,
        [fixture.clientId, fixture.ownerId],
        fixture.agencyId ?? "00000000-0000-4000-8000-000000000000",
      ],
    )
  ).rows as {
    event_id: string;
    recipient_id: string | null;
    agency_id: string | null;
    type: string;
    title: string;
    message: string;
    link: string;
    metadata: Record<string, string>;
  }[];

const session = (
  fixture: Fixture,
  metadata: Record<string, string>,
  id = `cs_it_${randomUUID()}`,
) =>
  ({
    id,
    payment_status: "paid",
    payment_intent: `pi_it_${randomUUID()}`,
    customer: fixture.customerId,
    currency: "usd",
    amount_total: AMOUNT,
    metadata: { clientId: fixture.clientId, ...metadata },
  }) as unknown as Stripe.Checkout.Session;

const offerSession = (fixture: Fixture, id?: string) =>
  session(
    fixture,
    { paymentType: "CONTRACT_MILESTONE", proposalId: fixture.proposalId },
    id,
  );

const fundingSession = (fixture: Fixture, id?: string) =>
  session(
    fixture,
    {
      paymentType: "CONTRACT_MILESTONE_FUNDING",
      contractId: fixture.contractId!,
      milestoneId: fixture.milestoneId!,
    },
    id,
  );

const submit = (fixture: Fixture) =>
  submitMilestone(
    fixture.ownerId,
    fixture.contractId!,
    fixture.milestoneId!,
    fixture.owner === "agency" ? "agency" : undefined,
    "The milestone work is complete.",
    undefined,
  );

const review = (
  fixture: Fixture,
  action: "APPROVE" | "REQUEST_CHANGES",
  feedback?: string,
) =>
  reviewMilestone(
    fixture.clientId,
    fixture.contractId!,
    fixture.milestoneId!,
    action,
    feedback,
  );

interface Flow {
  type: string;
  contract: ContractState;
  owners: Owner[];
  run: (fixture: Fixture) => Promise<unknown>;
  replayRejects: boolean;
  expected: (fixture: Fixture) => Promise<{
    recipient: "client" | "talent";
    title: string;
    message: string;
    link: string;
    metadata: Record<string, string>;
  }>;
}

const flows: Flow[] = [
  {
    type: "CONTRACT_OFFER",
    contract: "none",
    owners: ["freelancer", "agency"],
    run: (fixture) => createContractFromPayment(offerSession(fixture)),
    replayRejects: false,
    expected: async (fixture) => ({
      recipient: "talent",
      title: "New contract offer",
      message: `A client sent you a contract offer for “${JOB_TITLE}”.`,
      link: `/messages?conversationId=${fixture.conversationId}`,
      metadata: {
        contractId: (await contractIdOf(fixture))!,
        proposalId: fixture.proposalId,
      },
    }),
  },
  {
    type: "MILESTONE_FUNDED",
    contract: "pending",
    owners: ["freelancer", "agency"],
    run: (fixture) => fundContractMilestoneFromPayment(fundingSession(fixture)),
    replayRejects: false,
    expected: async (fixture) => ({
      recipient: "talent",
      title: "Milestone funded",
      message: `The client funded “${MILESTONE_TITLE}”. You can start work now.`,
      link: `/contracts?contractId=${fixture.contractId}`,
      metadata: {
        contractId: fixture.contractId!,
        milestoneId: fixture.milestoneId!,
      },
    }),
  },
  {
    type: "MILESTONE_SUBMITTED",
    contract: "active",
    owners: ["freelancer", "agency"],
    run: (fixture) => submit(fixture),
    replayRejects: false,
    expected: async (fixture) => ({
      recipient: "client",
      title: "Milestone submitted for review",
      message: `Work was submitted for “${MILESTONE_TITLE}”.`,
      link: `/messages?conversationId=${fixture.conversationId}`,
      metadata: {
        contractId: fixture.contractId!,
        milestoneId: fixture.milestoneId!,
      },
    }),
  },
  {
    type: "MILESTONE_APPROVED",
    contract: "review",
    owners: ["freelancer", "agency"],
    run: (fixture) => review(fixture, "APPROVE"),
    replayRejects: true,
    expected: async (fixture) => ({
      recipient: "talent",
      title: "Milestone accepted",
      message: `Your work for “${MILESTONE_TITLE}” was accepted.`,
      link: `/messages?conversationId=${fixture.conversationId}`,
      metadata: {
        contractId: fixture.contractId!,
        milestoneId: fixture.milestoneId!,
      },
    }),
  },
  {
    type: "MILESTONE_CHANGES_REQUESTED",
    contract: "review",
    owners: ["freelancer", "agency"],
    run: (fixture) =>
      review(fixture, "REQUEST_CHANGES", "Please adjust the layout."),
    replayRejects: true,
    expected: async (fixture) => ({
      recipient: "talent",
      title: "Modifications requested",
      message: `The client requested modifications for “${MILESTONE_TITLE}”.`,
      link: `/messages?conversationId=${fixture.conversationId}`,
      metadata: {
        contractId: fixture.contractId!,
        milestoneId: fixture.milestoneId!,
      },
    }),
  },
];

const target = (
  fixture: Fixture,
  recipient: "client" | "talent",
): { recipient_id: string | null; agency_id: string | null } => {
  if (recipient === "client") {
    return { recipient_id: fixture.clientId, agency_id: null };
  }
  return fixture.agencyId
    ? { recipient_id: null, agency_id: fixture.agencyId }
    : { recipient_id: fixture.ownerId, agency_id: null };
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
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue("disabled");
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.refundCreate.mockReset();
  mocks.refundCreate.mockResolvedValue({ id: "re_it", status: "succeeded" });
  mocks.push.mockReset();
  mocks.emit.mockReset();
  mocks.emitAgency.mockReset();
  mocks.warn.mockReset();
  mocks.warn.mockResolvedValue(undefined);
  mocks.failAfterInsert = false;
  mocks.emitThrows = false;
  mocks.visibleAtPush.length = 0;
});

describe("test environment", () => {
  it("runs with RabbitMQ disabled", () => {
    expect(isRabbitEnabled()).toBe(false);
  });
});

for (const flow of flows) {
  for (const owner of flow.owners) {
    describe(`${flow.type} (${owner})`, () => {
      it("stores the exact row after commit, pushes it once and never publishes to the broker (RabbitMQ disabled)", async () => {
        const fixture = await seed(owner, flow.contract);

        await flow.run(fixture);

        const expected = await flow.expected(fixture);
        const rows = await stored(fixture, flow.type);
        expect(rows).toEqual([
          {
            event_id: expect.any(String),
            ...target(fixture, expected.recipient),
            type: flow.type,
            title: expected.title,
            message: expected.message,
            link: expected.link,
            metadata: expected.metadata,
          },
        ]);
        expect(mocks.push).toHaveBeenCalledTimes(1);
        expect(mocks.push).toHaveBeenCalledWith(
          expect.objectContaining({ event_id: rows[0]!.event_id }),
        );
        expect(mocks.visibleAtPush).toEqual([1]);
        const emitted =
          expected.recipient === "talent" && fixture.agencyId
            ? mocks.emitAgency
            : mocks.emit;
        expect(emitted).toHaveBeenCalledTimes(1);
        expect(emitted.mock.calls[0]![0]).toBe(
          expected.recipient === "client"
            ? fixture.clientId
            : (fixture.agencyId ?? fixture.ownerId),
        );
        expect(emitted.mock.calls[0]![1]).toMatchObject({
          eventId: rows[0]!.event_id,
          type: flow.type,
          title: expected.title,
          message: expected.message,
        });
        expect(mocks.sendNotification).not.toHaveBeenCalled();
      });

      it("leaves no notification and no state change when the transaction fails after the insert", async () => {
        const fixture = await seed(owner, flow.contract);
        const before = await probe(fixture);
        mocks.failAfterInsert = true;

        await expect(flow.run(fixture)).rejects.toThrow("injected failure");

        expect(await stored(fixture, flow.type)).toEqual([]);
        expect(await probe(fixture)).toBe(before);
        expect(mocks.push).not.toHaveBeenCalled();
        expect(mocks.emit).not.toHaveBeenCalled();
        expect(mocks.emitAgency).not.toHaveBeenCalled();
        expect(mocks.sendNotification).not.toHaveBeenCalled();
      });

      it("does not fail the request when the push fails", async () => {
        const fixture = await seed(owner, flow.contract);
        mocks.emitThrows = true;

        await flow.run(fixture);

        expect(await stored(fixture, flow.type)).toHaveLength(1);
        expect(mocks.push).toHaveBeenCalledTimes(1);
        expect(mocks.warn).toHaveBeenCalledWith(
          expect.objectContaining({ eventName: "notifications.push.failed" }),
        );
      });

      it("creates no second row and no second push on a replay of the same transition (a repeated submit while awaiting review is a new submission with its own message, row and push)", async () => {
        const fixture = await seed(owner, flow.contract);
        await flow.run(fixture);

        if (flow.type === "MILESTONE_SUBMITTED") {
          await flow.run(fixture);
          expect(await stored(fixture, flow.type)).toHaveLength(2);
          expect(mocks.push).toHaveBeenCalledTimes(2);
          expect(mocks.sendNotification).not.toHaveBeenCalled();
          return;
        }
        if (flow.replayRejects) {
          await expect(flow.run(fixture)).rejects.toMatchObject({
            statusCode: 409,
          });
        } else if (flow.type === "CONTRACT_OFFER") {
          await createContractFromPayment(offerSession(fixture));
        } else {
          await fundContractMilestoneFromPayment(fundingSession(fixture));
        }

        expect(await stored(fixture, flow.type)).toHaveLength(1);
        expect(mocks.push).toHaveBeenCalledTimes(1);
        expect(mocks.sendNotification).not.toHaveBeenCalled();
      });
    });
  }
}

describe("concurrent identical funding webhook deliveries", () => {
  it("produce one row and one push", async () => {
    const fixture = await seed("freelancer", "pending");
    const delivery = fundingSession(fixture, `cs_it_${randomUUID()}`);

    const results = await Promise.allSettled([
      fundContractMilestoneFromPayment(delivery),
      fundContractMilestoneFromPayment(delivery),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(await stored(fixture, "MILESTONE_FUNDED")).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });
});

describe("event ids", () => {
  it("are deterministic per transition and distinct per review round", async () => {
    const fixture = await seed("freelancer", "active");

    await submit(fixture);
    await review(fixture, "REQUEST_CHANGES", "Round one feedback.");
    await submit(fixture);
    await review(fixture, "REQUEST_CHANGES", "Round two feedback.");

    const submitted = await stored(fixture, "MILESTONE_SUBMITTED");
    const changes = await stored(fixture, "MILESTONE_CHANGES_REQUESTED");
    expect(submitted).toHaveLength(2);
    expect(changes).toHaveLength(2);
    expect(new Set(changes.map((row) => row.event_id)).size).toBe(2);
    expect(new Set(submitted.map((row) => row.event_id)).size).toBe(2);
    expect(mocks.push).toHaveBeenCalledTimes(4);
  });

  it("use the contract id with offer and the milestone id with funded", async () => {
    const offer = await seed("freelancer", "none");
    await createContractFromPayment(offerSession(offer));
    const contractId = (await contractIdOf(offer))!;
    expect((await stored(offer, "CONTRACT_OFFER"))[0]!.event_id).toBe(
      notificationEventId("CONTRACT_OFFER", contractId, "offer"),
    );

    const funded = await seed("freelancer", "pending");
    await fundContractMilestoneFromPayment(fundingSession(funded));
    expect((await stored(funded, "MILESTONE_FUNDED"))[0]!.event_id).toBe(
      notificationEventId("MILESTONE_FUNDED", funded.milestoneId!, "funded"),
    );
  });
});

describe("pushStoredNotification", () => {
  it("never throws and logs only the error name and code", async () => {
    const fixture = await seed("freelancer", "pending");
    await fundContractMilestoneFromPayment(fundingSession(fixture));
    const [row] = (
      await pool.query("select * from notifications where recipient_id = $1", [
        fixture.ownerId,
      ])
    ).rows;
    mocks.emitThrows = true;
    mocks.warn.mockClear();

    await expect(
      pushStoredNotification({
        ...row,
        created_at: new Date(row.created_at),
      }),
    ).resolves.toBeUndefined();

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]![0]).toEqual({
      message: "Stored notification push failed",
      eventName: "notifications.push.failed",
      attributes: { "error.type": "Error", "error.code": "EPIPE" },
    });
  });
});
