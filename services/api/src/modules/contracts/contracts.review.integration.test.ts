import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import {
  afterAll,
  afterEach,
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
  loggerWarn: vi.fn(),
}));

vi.mock("../../config/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/logger.js")>();
  return {
    ...original,
    logger: { ...original.logger, warn: mocks.loggerWarn },
  };
});

vi.mock("../../events/publisher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../events/publisher.js")>()),
  sendNotification: mocks.sendNotification,
}));

vi.mock("../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { PLATFORM_FEE_RATE } from "../../config/constants.js";
import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_earning,
  agency_metadata,
  client_spents,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  earning_history,
  freelancer_earning,
  job_posts,
  messages,
  proposals,
} from "../../database/schema.js";
import { errorHandler } from "../../middleware/error.middleware.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { ApiError } from "../../utils/api-error.js";
import { reviewMilestoneWork } from "./contracts.controller.js";
import { reviewContractMilestone } from "./contracts.service.js";

const PREFIX = "milestone-it-";
const AMOUNT = "200.00";
const FEE = (
  Math.round(Number(AMOUNT) * PLATFORM_FEE_RATE * 100) / 100
).toFixed(2);
const NET = (Number(AMOUNT) - Number(FEE)).toFixed(2);
const NOT_AWAITING = "This milestone is not awaiting review.";

const created = {
  accountIds: [] as string[],
  agencyIds: [] as string[],
  jobIds: [] as string[],
  proposalIds: [] as string[],
  contractIds: [] as string[],
  conversationIds: [] as string[],
};

const purgeLeftovers = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const countLeftovers = async () => {
  const like = `${PREFIX}%`;
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
       (select count(*) from agency_metadata where owner_id like $1) +
       (select count(*) from contracts where client_id like $1) +
       (select count(*) from conversations where context_key like $1)
     )::text as total`,
    [like],
  );
  return Number(result.rows[0]?.total ?? 0);
};

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  created.accountIds.push(authId);
  return authId;
};

const createFixture = async (owner: "freelancer" | "agency" = "freelancer") => {
  const clientId = await insertAccount("CLIENT");
  const ownerAccountId = await insertAccount("FREELANCER");

  let agencyId: string | null = null;
  if (owner === "agency") {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerAccountId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "integration test agency",
      })
      .returning({ id: agency_metadata.id });
    agencyId = agency!.id;
    created.agencyIds.push(agencyId);
  }

  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Integration job",
      description: "Integration test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget: AMOUNT,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  created.jobIds.push(job!.id);

  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: `${PREFIX}${randomUUID()}`,
      sender_type: agencyId ? "AGENCY" : "FREELANCER",
      cover_letter: "integration",
      bid_amount: AMOUNT,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  created.proposalIds.push(proposal!.id);

  const [contract] = await db
    .insert(contracts)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      client_id: clientId,
      freelancer_id: agencyId ? null : ownerAccountId,
      agency_id: agencyId,
      title: "Integration contract",
      total_amount: AMOUNT,
      status: "ACTIVE",
    })
    .returning({ id: contracts.id });
  created.contractIds.push(contract!.id);

  const [conversation] = await db
    .insert(conversations)
    .values({
      proposal_id: proposal!.id,
      job_id: job!.id,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  created.conversationIds.push(conversation!.id);

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
          account_id: ownerAccountId,
          participant_type: "FREELANCER",
        },
  ]);

  const [milestone] = await db
    .insert(contract_milestones)
    .values({
      contract_id: contract!.id,
      title: "Integration milestone",
      amount: AMOUNT,
      due_date: "2026-01-01",
      position: 0,
      status: "ACTIVE",
      funded_at: new Date(),
      payment_requested_at: new Date(),
    })
    .returning({ id: contract_milestones.id });

  return {
    clientId,
    ownerAccountId,
    agencyId,
    contractId: contract!.id,
    milestoneId: milestone!.id,
    conversationId: conversation!.id,
  };
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const review = (
  fixture: Fixture,
  action: "APPROVE" | "REQUEST_CHANGES",
  clientId = fixture.clientId,
) =>
  reviewContractMilestone(
    fixture.contractId,
    fixture.milestoneId,
    clientId,
    action,
    action === "REQUEST_CHANGES" ? "Please fix the layout." : undefined,
  );

const readState = async (fixture: Fixture) => {
  const [milestone] = await db
    .select()
    .from(contract_milestones)
    .where(eq(contract_milestones.id, fixture.milestoneId));
  const earnings = await db
    .select()
    .from(earning_history)
    .where(eq(earning_history.milestone_id, fixture.milestoneId));
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, fixture.conversationId));
  const participants = await db
    .select()
    .from(conversation_participants)
    .where(
      eq(conversation_participants.conversation_id, fixture.conversationId),
    );
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, fixture.conversationId));
  const [freelancerTotals] = await db
    .select()
    .from(freelancer_earning)
    .where(eq(freelancer_earning.freelancer_id, fixture.ownerAccountId));
  const [agencyTotals] = fixture.agencyId
    ? await db
        .select()
        .from(agency_earning)
        .where(eq(agency_earning.agency_id, fixture.agencyId))
    : [];
  const [spent] = await db
    .select()
    .from(client_spents)
    .where(eq(client_spents.client_id, fixture.clientId));
  const unreadOf = (accountId: string | null, agencyId?: string | null) =>
    participants.find((participant) =>
      agencyId
        ? participant.agency_id === agencyId
        : participant.account_id === accountId,
    )?.unread_count;
  return {
    milestone: milestone!,
    earnings,
    rows,
    conversation: conversation!,
    freelancerTotals,
    agencyTotals,
    spent,
    ownerUnread: unreadOf(fixture.ownerAccountId, fixture.agencyId),
    clientUnread: unreadOf(fixture.clientId),
  };
};

const expectRejected409 = (result: PromiseSettledResult<unknown>) => {
  expect(result.status).toBe("rejected");
  const reason = (result as PromiseRejectedResult).reason;
  expect(reason).toBeInstanceOf(ApiError);
  expect(reason).toMatchObject({ statusCode: 409, message: NOT_AWAITING });
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purgeLeftovers();
});

afterAll(async () => {
  const leftovers = await countLeftovers();
  await pool.end();
  expect(leftovers).toBe(0);
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.loggerWarn.mockReset();
  mocks.loggerWarn.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  const take = <T>(list: T[]) => list.splice(0);
  const conversationIds = take(created.conversationIds);
  const contractIds = take(created.contractIds);
  const proposalIds = take(created.proposalIds);
  const jobIds = take(created.jobIds);
  const agencyIds = take(created.agencyIds);
  const accountIds = take(created.accountIds);
  if (conversationIds.length > 0) {
    await db
      .delete(conversations)
      .where(inArray(conversations.id, conversationIds));
  }
  if (contractIds.length > 0) {
    await db.delete(contracts).where(inArray(contracts.id, contractIds));
  }
  if (proposalIds.length > 0) {
    await db.delete(proposals).where(inArray(proposals.id, proposalIds));
  }
  if (jobIds.length > 0) {
    await db.delete(job_posts).where(inArray(job_posts.id, jobIds));
  }
  if (agencyIds.length > 0) {
    await db
      .delete(agency_metadata)
      .where(inArray(agency_metadata.id, agencyIds));
  }
  if (accountIds.length > 0) {
    await db.delete(accounts).where(inArray(accounts.auth_id, accountIds));
  }
});

describe("reviewContractMilestone normal paths", () => {
  it("approves a freelancer milestone and records the earning", async () => {
    const fixture = await createFixture();

    const result = await review(fixture, "APPROVE");

    expect(result.approved).toBe(true);
    expect(result.freelancerId).toBe(fixture.ownerAccountId);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("COMPLETED");
    expect(state.milestone.completed_at).toBeInstanceOf(Date);
    expect(state.milestone.payment_requested_at).not.toBeNull();
    expect(state.earnings).toHaveLength(1);
    expect(state.earnings[0]).toMatchObject({
      freelancer_id: fixture.ownerAccountId,
      agency_id: null,
      amount: AMOUNT,
      platform_fee_amount: FEE,
    });
    expect(state.freelancerTotals?.total_earning).toBe(NET);
    expect(state.spent?.total_spent).toBe(AMOUNT);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      message_type: "SYSTEM_EVENT",
      event_type: "MILESTONE_APPROVED",
      sender_id: fixture.clientId,
    });
    expect(state.conversation.last_message_id).toBe(state.rows[0]!.id);
    expect(state.ownerUnread).toBe(1);
    expect(state.clientUnread).toBe(0);
  });

  it("approves an agency milestone and records the agency earning", async () => {
    const fixture = await createFixture("agency");

    const result = await review(fixture, "APPROVE");

    expect(result.agencyId).toBe(fixture.agencyId);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("COMPLETED");
    expect(state.earnings).toHaveLength(1);
    expect(state.earnings[0]).toMatchObject({
      freelancer_id: null,
      agency_id: fixture.agencyId,
    });
    expect(state.agencyTotals?.total_earning).toBe(NET);
    expect(state.freelancerTotals).toBeUndefined();
    expect(state.ownerUnread).toBe(1);
  });

  it("requests changes without completing or paying the milestone", async () => {
    const fixture = await createFixture();

    const result = await review(fixture, "REQUEST_CHANGES");

    expect(result.approved).toBe(false);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("ACTIVE");
    expect(state.milestone.payment_requested_at).toBeNull();
    expect(state.milestone.completed_at).toBeNull();
    expect(state.earnings).toHaveLength(0);
    expect(state.freelancerTotals).toBeUndefined();
    expect(state.spent).toBeUndefined();
    expect(
      state.rows.map((row) => row.event_type ?? row.message_type).sort(),
    ).toEqual(["MILESTONE_CHANGES_REQUESTED", "USER"]);
    expect(state.rows.find((row) => row.message_type === "USER")?.body).toBe(
      "Please fix the layout.",
    );
    expect(state.ownerUnread).toBe(2);
    expect(state.clientUnread).toBe(0);
  });

  it("answers 404 for a different client and 409 for a milestone not under review", async () => {
    const fixture = await createFixture();
    const other = await insertAccount("CLIENT");

    await expect(review(fixture, "APPROVE", other)).rejects.toMatchObject({
      statusCode: 404,
    });

    await db
      .update(contract_milestones)
      .set({ payment_requested_at: null })
      .where(eq(contract_milestones.id, fixture.milestoneId));
    await expect(review(fixture, "APPROVE")).rejects.toMatchObject({
      statusCode: 409,
      message: NOT_AWAITING,
    });
    const state = await readState(fixture);
    expect(state.earnings).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
  });
});

describe("reviewContractMilestone double review", () => {
  it("rejects a sequential second approval and pays once", async () => {
    const fixture = await createFixture();

    await review(fixture, "APPROVE");
    await expect(review(fixture, "APPROVE")).rejects.toMatchObject({
      statusCode: 409,
      message: NOT_AWAITING,
    });

    const state = await readState(fixture);
    expect(state.earnings).toHaveLength(1);
    expect(state.freelancerTotals?.total_earning).toBe(NET);
    expect(state.spent?.total_spent).toBe(AMOUNT);
    expect(state.rows).toHaveLength(1);
    expect(state.ownerUnread).toBe(1);
  });

  it("lets exactly one of two request-changes that are both blocked on the guarded update win", async () => {
    const fixture = await createFixture();

    const results = await raceBlockedOnGuardedUpdate(fixture, [
      "REQUEST_CHANGES",
      "REQUEST_CHANGES",
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expectRejected409(results.find((r) => r.status === "rejected")!);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("ACTIVE");
    expect(state.milestone.payment_requested_at).toBeNull();
    expect(state.rows).toHaveLength(2);
    expect(
      state.rows.filter(
        (row) => row.event_type === "MILESTONE_CHANGES_REQUESTED",
      ),
    ).toHaveLength(1);
    expect(state.ownerUnread).toBe(2);
    expect(state.earnings).toHaveLength(0);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  }, 30000);

  it("maps an earning_history unique violation to 409 and rolls back", async () => {
    const fixture = await createFixture();
    await db.insert(earning_history).values({
      freelancer_id: fixture.ownerAccountId,
      contract_id: fixture.contractId,
      milestone_id: fixture.milestoneId,
      amount: AMOUNT,
      platform_fee_amount: FEE,
      description: "pre-existing earning",
    });

    await expect(review(fixture, "APPROVE")).rejects.toMatchObject({
      statusCode: 409,
      message: NOT_AWAITING,
    });

    const state = await readState(fixture);
    expect(state.milestone.status).toBe("ACTIVE");
    expect(state.milestone.completed_at).toBeNull();
    expect(state.earnings).toHaveLength(1);
    expect(state.earnings[0]!.description).toBe("pre-existing earning");
    expect(state.freelancerTotals).toBeUndefined();
    expect(state.spent).toBeUndefined();
    expect(state.rows).toHaveLength(0);
    expect(state.ownerUnread).toBe(0);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).toHaveBeenCalledWith({
      message: expect.any(String),
      eventName: "contracts.milestone.review_conflict",
      attributes: {
        "contract.id": fixture.contractId,
        "milestone.id": fixture.milestoneId,
      },
    });
  });

  it.each([
    ["a logger that rejects", () => Promise.reject(new Error("log down"))],
    [
      "a logger that throws",
      () => {
        throw new Error("log broke");
      },
    ],
  ])("still answers 409 with %s", async (_label, behavior) => {
    const fixture = await createFixture();
    await db.insert(earning_history).values({
      freelancer_id: fixture.ownerAccountId,
      contract_id: fixture.contractId,
      milestone_id: fixture.milestoneId,
      amount: AMOUNT,
      platform_fee_amount: FEE,
      description: "pre-existing earning",
    });
    mocks.loggerWarn.mockImplementation(behavior);

    await expect(review(fixture, "APPROVE")).rejects.toMatchObject({
      statusCode: 409,
      message: NOT_AWAITING,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another constraint", { code: "23505", constraint: "some_other_unique" }],
    [
      "another error code on the earning constraint",
      { code: "23503", constraint: "earning_history_milestone_id_unique" },
    ],
  ])("does not map %s to 409", async (_label, fields) => {
    const fixture = await createFixture();
    const failure = Object.assign(
      new Error("simulated database error"),
      fields,
    );
    const original = db.transaction.bind(db) as (
      callback: (transaction: unknown) => Promise<unknown>,
    ) => Promise<unknown>;
    vi.spyOn(db, "transaction").mockImplementationOnce(((
      callback: (transaction: unknown) => Promise<unknown>,
    ) =>
      original(async (transaction) => {
        await callback(transaction);
        throw failure;
      })) as never);

    const outcome = await review(fixture, "APPROVE").then(
      () => null,
      (error: unknown) => error,
    );

    expect(outcome).toBe(failure);
    expect(outcome).not.toBeInstanceOf(ApiError);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("ACTIVE");
    expect(state.earnings).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
    expect(state.freelancerTotals).toBeUndefined();
    expect(state.ownerUnread).toBe(0);
  });
});

const BLOCKED_UPDATES = `
  select count(*)::int as blocked
  from pg_stat_activity a
  where a.datname = current_database()
    and a.wait_event_type = 'Lock'
    and a.query ilike 'update "contract_milestones"%'
    and ($1::int = any(pg_blocking_pids(a.pid))
      or exists (
        select 1 from unnest(pg_blocking_pids(a.pid)) as b
        where $1::int = any(pg_blocking_pids(b))
      ))`;

const waitForBlockedUpdates = async (holderPid: number, expected: number) => {
  const deadline = Date.now() + 8000;
  for (;;) {
    const result = await pool.query<{ blocked: number }>(BLOCKED_UPDATES, [
      holderPid,
    ]);
    const blocked = result.rows[0]?.blocked ?? 0;
    if (blocked >= expected) return blocked;
    if (Date.now() > deadline) {
      throw new Error(
        `Expected ${expected} reviews blocked on the guarded update, saw ${blocked}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const raceBlockedOnGuardedUpdate = async (
  fixture: Fixture,
  actions: Array<"APPROVE" | "REQUEST_CHANGES">,
) => {
  const holder = await pool.connect();
  let released = false;
  const releaseHolder = async () => {
    if (released) return;
    released = true;
    try {
      await holder.query("rollback");
      holder.release();
    } catch (error) {
      holder.release(error as Error);
    }
  };
  try {
    await holder.query("begin");
    await holder.query(
      "select id from contract_milestones where id = $1 for update",
      [fixture.milestoneId],
    );
    const pidResult = await holder.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const holderPid = pidResult.rows[0]!.pid;

    const pending = Promise.allSettled(
      actions.map((action) => review(fixture, action)),
    );
    try {
      expect(await waitForBlockedUpdates(holderPid, actions.length)).toBe(
        actions.length,
      );
    } finally {
      await releaseHolder();
    }
    return await pending;
  } finally {
    await releaseHolder();
  }
};

describe("reviewContractMilestone races decided by the guarded update", () => {
  it("lets exactly one of three approvals that are all blocked on the guarded update win", async () => {
    const fixture = await createFixture();

    const results = await raceBlockedOnGuardedUpdate(fixture, [
      "APPROVE",
      "APPROVE",
      "APPROVE",
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const losers = results.filter((r) => r.status === "rejected");
    expect(losers).toHaveLength(2);
    for (const loser of losers) expectRejected409(loser);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("COMPLETED");
    expect(state.earnings).toHaveLength(1);
    expect(state.freelancerTotals?.total_earning).toBe(NET);
    expect(state.spent?.total_spent).toBe(AMOUNT);
    expect(state.rows).toHaveLength(1);
    expect(state.ownerUnread).toBe(1);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  }, 30000);

  it("lets exactly one of two approvals that are both blocked on the guarded update win", async () => {
    const fixture = await createFixture();

    const results = await raceBlockedOnGuardedUpdate(fixture, [
      "APPROVE",
      "APPROVE",
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expectRejected409(results.find((r) => r.status === "rejected")!);
    const state = await readState(fixture);
    expect(state.milestone.status).toBe("COMPLETED");
    expect(state.earnings).toHaveLength(1);
    expect(state.freelancerTotals?.total_earning).toBe(NET);
    expect(state.spent?.total_spent).toBe(AMOUNT);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.event_type).toBe("MILESTONE_APPROVED");
    expect(state.ownerUnread).toBe(1);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  }, 30000);

  it.each([
    ["APPROVE", "REQUEST_CHANGES"],
    ["REQUEST_CHANGES", "APPROVE"],
  ] as const)(
    "keeps one consistent final state for %s racing %s, both blocked on the guarded update",
    async (first, second) => {
      const fixture = await createFixture();

      const results = await raceBlockedOnGuardedUpdate(fixture, [
        first,
        second,
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expectRejected409(results.find((r) => r.status === "rejected")!);
      const winner = results[0]!.status === "fulfilled" ? first : second;
      const state = await readState(fixture);
      if (winner === "APPROVE") {
        expect(state.milestone.status).toBe("COMPLETED");
        expect(state.milestone.payment_requested_at).not.toBeNull();
        expect(state.earnings).toHaveLength(1);
        expect(state.freelancerTotals?.total_earning).toBe(NET);
        expect(state.spent?.total_spent).toBe(AMOUNT);
        expect(state.rows).toHaveLength(1);
        expect(state.rows[0]!.event_type).toBe("MILESTONE_APPROVED");
        expect(state.ownerUnread).toBe(1);
      } else {
        expect(state.milestone.status).toBe("ACTIVE");
        expect(state.milestone.payment_requested_at).toBeNull();
        expect(state.milestone.completed_at).toBeNull();
        expect(state.earnings).toHaveLength(0);
        expect(state.freelancerTotals).toBeUndefined();
        expect(state.spent).toBeUndefined();
        expect(state.rows).toHaveLength(2);
        expect(
          state.rows.filter(
            (row) => row.event_type === "MILESTONE_CHANGES_REQUESTED",
          ),
        ).toHaveLength(1);
        expect(state.ownerUnread).toBe(2);
      }
      expect(mocks.loggerWarn).not.toHaveBeenCalled();
    },
    30000,
  );
});

describe("review controller on a lost race", () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    if (userId) {
      req.auth = {
        userId,
        role: "client",
        accountExists: true,
        isOnboarded: true,
      };
    }
    req.logger = {
      warn: async () => undefined,
      info: async () => undefined,
      error: async () => undefined,
    } as unknown as typeof req.logger;
    next();
  });
  app.post(
    "/contracts/:contractId/milestones/:milestoneId/review",
    reviewMilestoneWork,
  );
  app.use(errorHandler);

  const send = (fixture: Fixture, action: "APPROVE" | "REQUEST_CHANGES") =>
    request(app)
      .post(
        `/contracts/${fixture.contractId}/milestones/${fixture.milestoneId}/review`,
      )
      .set("x-test-user", fixture.clientId)
      .send({ action, feedback: "Please fix the layout." });

  it("answers 200 then 409 sequentially and notifies once", async () => {
    const fixture = await createFixture();

    const first = await send(fixture, "APPROVE");
    const second = await send(fixture, "APPROVE");

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ success: false, message: NOT_AWAITING });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
  });

  it("answers 200 and 409 for parallel requests and notifies once", async () => {
    const fixture = await createFixture();

    const responses = await Promise.all([
      send(fixture, "APPROVE"),
      send(fixture, "APPROVE"),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    const state = await readState(fixture);
    expect(state.earnings).toHaveLength(1);
    expect(state.freelancerTotals?.total_earning).toBe(NET);
  });

  it("answers 409 for the mapped unique violation without notifying", async () => {
    const fixture = await createFixture();
    await db.insert(earning_history).values({
      freelancer_id: fixture.ownerAccountId,
      contract_id: fixture.contractId,
      milestone_id: fixture.milestoneId,
      amount: AMOUNT,
      platform_fee_amount: FEE,
      description: "pre-existing earning",
    });

    const response = await send(fixture, "APPROVE");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ success: false, message: NOT_AWAITING });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    const [row] = await db
      .select({ status: contract_milestones.status })
      .from(contract_milestones)
      .where(
        and(
          eq(contract_milestones.id, fixture.milestoneId),
          eq(contract_milestones.status, "ACTIVE"),
        ),
      );
    expect(row).toBeDefined();
  });
});
