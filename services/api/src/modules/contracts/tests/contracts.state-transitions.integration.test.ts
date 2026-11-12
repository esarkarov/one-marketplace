import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
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
}));

vi.mock(
  "../../../infrastructure/events/publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../infrastructure/events/publisher.js")
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
  client_spents,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  freelancer_earning,
  job_posts,
  messages,
  proposals,
  reviews,
} from "../../../database/schema.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  countBlocked,
  holdRowLock,
  openLockHolder,
  raceBlocked,
  waitForBlocked,
} from "../../../test/support/lock-holder.js";
import { ApiError } from "../../../shared/http/api-error.js";
import {
  acceptContract,
  finishContractWithReview,
} from "../services/contracts.lifecycle.service.js";
import {
  addContractMilestone,
  reviewContractMilestone,
  submitContractMilestone,
} from "../services/contracts.milestones.service.js";

const PREFIX = "transition-it-";
const AMOUNT = 20000;

const UPDATE_CONTRACT = 'update "contracts"%';
const UPDATE_MILESTONE = 'update "contract_milestones"%';
const LOCK_CONTRACT = 'select "status" from "contracts"%';
const UPSERT_EARNING = 'insert into "freelancer_earning"%';

type MilestoneSeed = {
  status: "PENDING" | "ACTIVE" | "COMPLETED";
  requested?: boolean;
};

const created = {
  accountIds: [] as string[],
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
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const countLeftovers = async () => {
  const like = `${PREFIX}%`;
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
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
    identityVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  created.accountIds.push(authId);
  return authId;
};

const createFixture = async (
  options: {
    contractStatus?: "PENDING" | "ACTIVE" | "COMPLETED";
    milestones?: MilestoneSeed[];
  } = {},
) => {
  const contractStatus = options.contractStatus ?? "ACTIVE";
  const seeds = options.milestones ?? [{ status: "ACTIVE" }];
  const clientId = await insertAccount("CLIENT");
  const ownerAccountId = await insertAccount("FREELANCER");

  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Transition job",
      description: "Transition test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT * seeds.length,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  created.jobIds.push(job!.id);

  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: `${PREFIX}${randomUUID()}`,
      sender_type: "FREELANCER",
      cover_letter: "transition",
      bid_amount_cents: AMOUNT,
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
      freelancer_id: ownerAccountId,
      title: "Transition contract",
      total_amount_cents: AMOUNT * seeds.length,
      status: contractStatus,
      completed_at: contractStatus === "COMPLETED" ? new Date() : null,
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
    {
      conversation_id: conversation!.id,
      account_id: ownerAccountId,
      participant_type: "FREELANCER",
    },
  ]);

  const milestoneRows = await db
    .insert(contract_milestones)
    .values(
      seeds.map((seed, position) => ({
        contract_id: contract!.id,
        title: `Milestone ${position}`,
        amount_cents: AMOUNT,
        due_date: "2026-01-01",
        position,
        status: seed.status,
        funded_at: new Date(),
        payment_requested_at:
          seed.requested || seed.status === "COMPLETED" ? new Date() : null,
        completed_at: seed.status === "COMPLETED" ? new Date() : null,
      })),
    )
    .returning({ id: contract_milestones.id });

  return {
    clientId,
    ownerAccountId,
    jobId: job!.id,
    contractId: contract!.id,
    conversationId: conversation!.id,
    milestoneIds: milestoneRows.map((row) => row.id),
    milestoneId: milestoneRows[0]!.id,
  };
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const readState = async (fixture: Fixture) => {
  const milestones = await db
    .select()
    .from(contract_milestones)
    .where(eq(contract_milestones.contract_id, fixture.contractId))
    .orderBy(asc(contract_milestones.position));
  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, fixture.contractId));
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
  const [totals] = await db
    .select()
    .from(freelancer_earning)
    .where(eq(freelancer_earning.freelancer_id, fixture.ownerAccountId));
  const [spent] = await db
    .select()
    .from(client_spents)
    .where(eq(client_spents.client_id, fixture.clientId));
  const reviewRows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.contract_id, fixture.contractId));
  const unreadOf = (accountId: string) =>
    participants.find((participant) => participant.account_id === accountId)
      ?.unread_count;
  return {
    milestones,
    contract: contract!,
    rows,
    totals,
    spent,
    reviewRows,
    ownerUnread: unreadOf(fixture.ownerAccountId),
    clientUnread: unreadOf(fixture.clientId),
    events: (type: string) => rows.filter((row) => row.event_type === type),
  };
};

type State = Awaited<ReturnType<typeof readState>>;

const expectContractInvariants = (state: State) => {
  if (state.contract.status === "COMPLETED") {
    expect(state.milestones.map((milestone) => milestone.status)).not.toContain(
      "PENDING",
    );
    expect(state.milestones.map((milestone) => milestone.status)).not.toContain(
      "ACTIVE",
    );
  }
  const positions = state.milestones.map((milestone) => milestone.position);
  expect(new Set(positions).size).toBe(positions.length);
};

const settle = <T>(promise: Promise<T>) =>
  Promise.allSettled([promise]).then(([result]) => result!);

const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((result) => result.status === "fulfilled");

const rejected = (results: PromiseSettledResult<unknown>[]) =>
  results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

const expectApiError = (
  result: PromiseSettledResult<unknown>,
  statusCode: number,
  code: string | undefined,
) => {
  expect(result.status).toBe("rejected");
  const reason = (result as PromiseRejectedResult).reason;
  expect(reason).toBeInstanceOf(ApiError);
  expect(reason).toMatchObject({ statusCode, code });
};

const accept = (fixture: Fixture) =>
  acceptContract(fixture.contractId, fixture.ownerAccountId);

const submit = (fixture: Fixture, message: string = randomUUID()) =>
  submitContractMilestone(
    fixture.contractId,
    fixture.milestoneId,
    fixture.ownerAccountId,
    message,
  );

const approve = (fixture: Fixture) =>
  reviewContractMilestone(
    fixture.contractId,
    fixture.milestoneId,
    fixture.clientId,
    "APPROVE",
  );

const addMilestone = (fixture: Fixture, title = "Extra work") =>
  addContractMilestone(fixture.contractId, fixture.clientId, {
    title,
    amountCents: 1500,
    dueDate: "2030-01-01",
  });

const finish = (fixture: Fixture, who: "client" | "freelancer" = "client") =>
  finishContractWithReview(
    fixture.contractId,
    who === "client" ? fixture.clientId : fixture.ownerAccountId,
    who,
    5,
    "Great work",
  );

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
});

afterEach(async () => {
  vi.restoreAllMocks();
  const take = <T>(list: T[]) => list.splice(0);
  const conversationIds = take(created.conversationIds);
  const contractIds = take(created.contractIds);
  const proposalIds = take(created.proposalIds);
  const jobIds = take(created.jobIds);
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
  if (accountIds.length > 0) {
    await db.delete(accounts).where(inArray(accounts.auth_id, accountIds));
  }
});

describe("acceptContract races", () => {
  const pendingOffer = () =>
    createFixture({
      contractStatus: "PENDING",
      milestones: [{ status: "PENDING" }],
    });

  it("lets exactly one of two accepts blocked on the contract row win and counts once", async () => {
    const fixture = await pendingOffer();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: UPDATE_CONTRACT,
      starts: [() => accept(fixture), () => accept(fixture)],
    });

    expect(fulfilled(results)).toHaveLength(1);
    const [loser] = rejected(results);
    expect(loser!.reason).toBeInstanceOf(ApiError);
    expect(loser!.reason).toMatchObject({
      statusCode: 409,
      message: "Contract offer was already handled.",
      code: "CONTRACT_OFFER_NOT_ACCEPTABLE",
    });
    const state = await readState(fixture);
    expect(state.contract.status).toBe("ACTIVE");
    expect(state.milestones[0]!.status).toBe("ACTIVE");
    expect(state.totals?.ongoing_jobs).toBe(1);
    expect(state.spent?.ongoing_contracts).toBe(1);
    expect(state.events("CONTRACT_ACCEPTED")).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    expect(state.clientUnread).toBe(1);
  }, 30000);

  it("answers CONTRACT_OFFER_NOT_ACCEPTABLE and rolls back when the first milestone is no longer pending", async () => {
    const fixture = await createFixture({
      contractStatus: "PENDING",
      milestones: [{ status: "ACTIVE" }],
    });

    const result = await settle(accept(fixture));

    expectApiError(result, 409, "CONTRACT_OFFER_NOT_ACCEPTABLE");
    const state = await readState(fixture);
    expect(state.contract.status).toBe("PENDING");
    expect(state.totals).toBeUndefined();
    expect(state.spent).toBeUndefined();
    expect(state.rows).toHaveLength(0);
    expect(state.clientUnread).toBe(0);
  });
});

describe("submitContractMilestone races", () => {
  it("keeps invariants for two submits blocked on the milestone row", async () => {
    const fixture = await createFixture();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contract_milestones", fixture.milestoneId),
      queryPattern: UPDATE_MILESTONE,
      starts: [() => submit(fixture), () => submit(fixture)],
    });

    for (const loser of rejected(results)) {
      expectApiError(loser, 409, "MILESTONE_NOT_SUBMITTABLE");
    }
    const winners = fulfilled(results).length;
    expect(winners).toBeGreaterThanOrEqual(1);
    const state = await readState(fixture);
    expect(state.milestones[0]!.status).toBe("ACTIVE");
    expect(state.milestones[0]!.submission_message).not.toBeNull();
    expect(state.events("MILESTONE_SUBMITTED")).toHaveLength(winners);
    expect(state.clientUnread).toBe(winners);
  }, 30000);

  it("rejects a submit queued behind an approval and leaves the completed milestone untouched", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contract_milestones", fixture.milestoneId),
      queryPattern: UPDATE_MILESTONE,
      starts: [() => approve(fixture), () => submit(fixture)],
      ordered: true,
    });

    expect(results[0]!.status).toBe("fulfilled");
    expectApiError(results[1]!, 409, "MILESTONE_NOT_SUBMITTABLE");
    const state = await readState(fixture);
    expect(state.milestones[0]!.status).toBe("COMPLETED");
    expect(state.milestones[0]!.submission_message).toBeNull();
    expect(state.events("MILESTONE_SUBMITTED")).toHaveLength(0);
    expect(state.events("MILESTONE_APPROVED")).toHaveLength(1);
    expect(state.clientUnread).toBe(0);
  }, 30000);

  it("lets an approval queued behind a resubmit succeed on the same milestone", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contract_milestones", fixture.milestoneId),
      queryPattern: UPDATE_MILESTONE,
      starts: [() => submit(fixture, "resubmitted"), () => approve(fixture)],
      ordered: true,
    });

    expect(fulfilled(results)).toHaveLength(2);
    const state = await readState(fixture);
    expect(state.milestones[0]!.status).toBe("COMPLETED");
    expect(state.milestones[0]!.submission_message).toBe("resubmitted");
    expect(state.events("MILESTONE_SUBMITTED")).toHaveLength(1);
    expect(state.events("MILESTONE_APPROVED")).toHaveLength(1);
  }, 30000);

  it("never records a submission on a completed milestone in an unordered submit and approve race", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });

    const results = await Promise.allSettled([
      submit(fixture, "racing"),
      approve(fixture),
    ]);

    const [submitResult, approveResult] = results;
    expect(approveResult!.status).toBe("fulfilled");
    const state = await readState(fixture);
    expect(state.milestones[0]!.status).toBe("COMPLETED");
    if (submitResult!.status === "rejected") {
      expectApiError(submitResult, 409, "MILESTONE_NOT_SUBMITTABLE");
      expect(state.milestones[0]!.submission_message).toBeNull();
      expect(state.events("MILESTONE_SUBMITTED")).toHaveLength(0);
    } else {
      expect(state.milestones[0]!.submission_message).toBe("racing");
      expect(state.events("MILESTONE_SUBMITTED")).toHaveLength(1);
    }
  }, 30000);
});

describe("addContractMilestone races", () => {
  const finishedMilestones = () =>
    createFixture({ milestones: [{ status: "COMPLETED" }] });

  it("lets exactly one of two adds blocked on the contract row win", async () => {
    const fixture = await finishedMilestones();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: LOCK_CONTRACT,
      starts: [
        () => addMilestone(fixture, "First add"),
        () => addMilestone(fixture, "Second add"),
      ],
    });

    expect(fulfilled(results)).toHaveLength(1);
    expectApiError(rejected(results)[0]!, 409, "MILESTONE_ADD_NOT_ALLOWED");
    const state = await readState(fixture);
    expect(state.milestones.map((milestone) => milestone.position)).toEqual([
      0, 1,
    ]);
    expect(state.contract.total_amount_cents).toBe(AMOUNT + 1500);
    expect(state.events("MILESTONE_ADDED")).toHaveLength(1);
    expect(state.ownerUnread).toBe(1);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
  }, 30000);

  it("rejects an add queued behind a finish and leaves no milestone on the completed contract", async () => {
    const fixture = await finishedMilestones();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: LOCK_CONTRACT,
      starts: [() => finish(fixture), () => addMilestone(fixture)],
      ordered: true,
    });

    expect(results[0]!.status).toBe("fulfilled");
    expectApiError(results[1]!, 409, "MILESTONE_ADD_NOT_ALLOWED");
    const state = await readState(fixture);
    expect(state.contract.status).toBe("COMPLETED");
    expect(state.milestones).toHaveLength(1);
    expectContractInvariants(state);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
  }, 30000);

  it("rejects a finish queued behind an add because the new milestone is incomplete", async () => {
    const fixture = await finishedMilestones();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: LOCK_CONTRACT,
      starts: [() => addMilestone(fixture), () => finish(fixture)],
      ordered: true,
    });

    expect(results[0]!.status).toBe("fulfilled");
    expectApiError(results[1]!, 409, "CONTRACT_HAS_INCOMPLETE_MILESTONES");
    const state = await readState(fixture);
    expect(state.contract.status).toBe("ACTIVE");
    expect(state.milestones).toHaveLength(2);
    expect(state.reviewRows).toHaveLength(0);
    expectContractInvariants(state);
  }, 30000);

  it("serializes an add behind a finish that already read its milestone check (a NOT EXISTS check without the contract FOR UPDATE lock would let the add commit first and leave a completed contract with an incomplete milestone)", async () => {
    const fixture = await finishedMilestones();
    await db
      .insert(freelancer_earning)
      .values({ freelancer_id: fixture.ownerAccountId });
    const holder = await openLockHolder(async (client) => {
      await client.query(
        "select freelancer_id from freelancer_earning where freelancer_id = $1 for update",
        [fixture.ownerAccountId],
      );
    });
    try {
      const finishPromise = settle(finish(fixture));
      await waitForBlocked(holder.pid, 1, UPSERT_EARNING);

      let addSettled = false;
      const addPromise = settle(addMilestone(fixture)).then((result) => {
        addSettled = true;
        return result;
      });
      const deadline = Date.now() + 8000;
      while (
        !addSettled &&
        (await countBlocked(holder.pid, LOCK_CONTRACT)) < 1 &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(
        addSettled,
        "add committed while the finish was between its milestone check and its commit",
      ).toBe(false);
      expect(await countBlocked(holder.pid, LOCK_CONTRACT)).toBe(1);

      await holder.release();
      const [finishResult, addResult] = await Promise.all([
        finishPromise,
        addPromise,
      ]);

      expect(finishResult.status).toBe("fulfilled");
      expectApiError(addResult, 409, "MILESTONE_ADD_NOT_ALLOWED");
      const state = await readState(fixture);
      expect(state.contract.status).toBe("COMPLETED");
      expect(state.milestones).toHaveLength(1);
      expectContractInvariants(state);
    } finally {
      await holder.release();
    }
  }, 30000);

  it("keeps invariants when an approval and an add race without a holder", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });

    const [approveResult, addResult] = await Promise.allSettled([
      approve(fixture),
      addMilestone(fixture),
    ]);

    expect(approveResult.status).toBe("fulfilled");
    const state = await readState(fixture);
    expectContractInvariants(state);
    if (addResult.status === "fulfilled") {
      expect(state.milestones).toHaveLength(2);
      expect(state.milestones[0]!.status).toBe("COMPLETED");
      expect(state.milestones[1]!.status).toBe("PENDING");
    } else {
      expectApiError(addResult, 409, "MILESTONE_ADD_NOT_ALLOWED");
      expect(state.milestones).toHaveLength(1);
    }
  }, 30000);

  it("rejects an add that reads the milestone while its approval is still uncommitted, then allows it after", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });
    const holder = await openLockHolder(
      holdRowLock("contract_milestones", fixture.milestoneId),
    );
    try {
      const approval = settle(approve(fixture));
      await waitForBlocked(holder.pid, 1, UPDATE_MILESTONE);

      const addWhileApproving = await settle(addMilestone(fixture));
      expectApiError(addWhileApproving, 409, "MILESTONE_ADD_NOT_ALLOWED");

      await holder.release();
      expect((await approval).status).toBe("fulfilled");
    } finally {
      await holder.release();
    }

    await addMilestone(fixture);
    const state = await readState(fixture);
    expect(state.milestones.map((milestone) => milestone.position)).toEqual([
      0, 1,
    ]);
    expectContractInvariants(state);
  }, 30000);
});

describe("finishContractWithReview races", () => {
  const readyToFinish = () =>
    createFixture({ milestones: [{ status: "COMPLETED" }] });

  it.each([
    ["client", "freelancer"],
    ["freelancer", "client"],
  ] as const)(
    "lets the %s finish first and rejects the %s queued behind it with CONTRACT_ALREADY_FINISHED",
    async (first, second) => {
      const fixture = await readyToFinish();

      const results = await raceBlocked<unknown>({
        hold: holdRowLock("contracts", fixture.contractId),
        queryPattern: LOCK_CONTRACT,
        starts: [() => finish(fixture, first), () => finish(fixture, second)],
        ordered: true,
      });

      expect(results[0]!.status).toBe("fulfilled");
      expectApiError(results[1]!, 409, "CONTRACT_ALREADY_FINISHED");
      const state = await readState(fixture);
      expect(state.contract.status).toBe("COMPLETED");
      expect(state.reviewRows).toHaveLength(1);
      expect(state.reviewRows[0]!.reviewer_id).toBe(
        first === "client" ? fixture.clientId : fixture.ownerAccountId,
      );
      expect(state.totals?.completed_jobs).toBe(1);
      expect(state.spent?.completed_contracts).toBe(1);
      expect(state.events("CONTRACT_COMPLETED")).toHaveLength(1);
    },
    30000,
  );

  it("answers the second parallel finish by the same reviewer with a coded 409 on an active contract", async () => {
    const fixture = await readyToFinish();

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: LOCK_CONTRACT,
      starts: [() => finish(fixture), () => finish(fixture)],
      ordered: true,
    });

    expect(results[0]!.status).toBe("fulfilled");
    expectApiError(results[1]!, 409, "CONTRACT_ALREADY_FINISHED");
    const state = await readState(fixture);
    expect(state.reviewRows).toHaveLength(1);
    expect(state.events("CONTRACT_COMPLETED")).toHaveLength(1);
  }, 30000);

  it("answers REVIEW_ALREADY_SUBMITTED, not a 500, for the same reviewer twice in parallel on a completed contract", async () => {
    const fixture = await createFixture({
      contractStatus: "COMPLETED",
      milestones: [{ status: "COMPLETED" }],
    });

    const results = await raceBlocked<unknown>({
      hold: holdRowLock("contracts", fixture.contractId),
      queryPattern: LOCK_CONTRACT,
      starts: [
        () => finish(fixture, "freelancer"),
        () => finish(fixture, "freelancer"),
      ],
    });

    expect(fulfilled(results)).toHaveLength(1);
    expectApiError(rejected(results)[0]!, 409, "REVIEW_ALREADY_SUBMITTED");
    const state = await readState(fixture);
    expect(state.reviewRows).toHaveLength(1);
    expect(state.spent?.review_count).toBe(1);
    expect(state.events("CONTRACT_COMPLETED")).toHaveLength(0);
  }, 30000);
});

describe("reviewContractMilestone against contract transitions", () => {
  it("rejects a finish that runs while the last approval is uncommitted, then finishes after it", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });
    const holder = await openLockHolder(
      holdRowLock("contract_milestones", fixture.milestoneId),
    );
    try {
      const approval = settle(approve(fixture));
      await waitForBlocked(holder.pid, 1, UPDATE_MILESTONE);

      const early = await settle(finish(fixture));
      expectApiError(early, 409, "CONTRACT_HAS_INCOMPLETE_MILESTONES");
      expect((await readState(fixture)).contract.status).toBe("ACTIVE");

      await holder.release();
      expect((await approval).status).toBe("fulfilled");
    } finally {
      await holder.release();
    }

    await finish(fixture);
    const state = await readState(fixture);
    expect(state.contract.status).toBe("COMPLETED");
    expect(state.reviewRows).toHaveLength(1);
    expectContractInvariants(state);
  }, 30000);

  it("never completes the contract with an incomplete milestone in an unordered approval and finish race", async () => {
    const fixture = await createFixture({
      milestones: [{ status: "ACTIVE", requested: true }],
    });

    const [approveResult, finishResult] = await Promise.allSettled([
      approve(fixture),
      finish(fixture),
    ]);

    expect(approveResult.status).toBe("fulfilled");
    const state = await readState(fixture);
    expectContractInvariants(state);
    if (finishResult.status === "fulfilled") {
      expect(state.contract.status).toBe("COMPLETED");
      expect(state.milestones[0]!.status).toBe("COMPLETED");
    } else {
      expectApiError(finishResult, 409, "CONTRACT_HAS_INCOMPLETE_MILESTONES");
      expect(state.contract.status).toBe("ACTIVE");
      expect(state.reviewRows).toHaveLength(0);
    }
  }, 30000);
});
