import { randomUUID } from "node:crypto";
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
  failAfterInsert: false,
  failInsert: false,
  warn: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env } };
});

vi.mock("@/config/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/logger.js")>();
  return {
    ...original,
    logger: {
      ...original.logger,
      warn: async (...args: Parameters<typeof original.logger.warn>) => {
        mocks.warn(...args);
        await original.logger.warn(...args);
      },
    },
  };
});

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get: async () => null,
    expire: async () => true,
    setEx: async () => "OK",
    del: async () => 1,
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

vi.mock(
  "@/modules/outbox/repositories/outbox.repository.js",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/modules/outbox/repositories/outbox.repository.js")
      >();
    return {
      ...original,
      insertOutboxEvent: async (
        ...args: Parameters<typeof original.insertOutboxEvent>
      ) => {
        if (mocks.failInsert) throw new Error("outbox unavailable");
        const inserted = await original.insertOutboxEvent(...args);
        if (mocks.failAfterInsert) throw new Error("injected failure");
        return inserted;
      },
    };
  },
);

import { db, pool } from "@/database/client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import { markProposalViewed } from "@/modules/proposals/services/proposals.review.service.js";
import {
  submitAgencyProposal,
  submitProposal,
} from "@/modules/proposals/services/proposals.submission.service.js";
import {
  accounts,
  agency_members,
  agency_metadata,
  connects,
  freelancer_metadata,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  OUTBOX_MODES,
  deleteOutboxRows,
  outboxRows,
  resetOutboxMode,
  setOutboxMode,
  withoutEventId,
} from "@/test/support/outbox-mode.js";

const PREFIX = "proposals-outbox-it-";
const touchedEventIds: string[] = [];

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    identityVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const seed = async (senderType: "FREELANCER" | "AGENCY") => {
  const clientId = await insertAccount("CLIENT");
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Outbox job",
      description: "desc",
      expertise_level: "EXPERT",
      expected_duration: "1 month",
      skills: ["node"],
      total_budget_cents: 100000,
      milestones: [],
      status: "PUBLISHED",
      published_at: new Date(),
    })
    .returning({ id: job_posts.id });
  const freelancerId = await insertAccount("FREELANCER");
  await db.insert(freelancer_metadata).values({
    auth_id: freelancerId,
    professional_title: "Engineer",
    professional_description: "desc",
    hourly_rate_cents: 5000,
    country: "US",
    city: "Austin",
    weekly_availability: "30",
    experience_level: "EXPERT",
    skills: ["node"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  let agencyId: string | null = null;
  if (senderType === "AGENCY") {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: freelancerId,
        name: `${PREFIX}agency`,
        size: "1-10",
        specialty: "design",
        overview: "overview",
        tags: ["figma"],
      })
      .returning({ id: agency_metadata.id });
    agencyId = agency!.id;
    await db.insert(agency_members).values({
      agency_id: agencyId,
      freelancer_id: freelancerId,
      role: "Founder",
    });
    await db.insert(connects).values({ agency_id: agencyId, connects: 100 });
  } else {
    await db
      .insert(connects)
      .values({ freelancer_id: freelancerId, connects: 100 });
  }
  return { clientId, freelancerId, agencyId, jobId: job!.id };
};

type Fixture = Awaited<ReturnType<typeof seed>>;

const insertSubmittedProposal = async (fixture: Fixture) => {
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: fixture.jobId,
      sender_id: fixture.agencyId ?? fixture.freelancerId,
      sender_type: fixture.agencyId ? "AGENCY" : "FREELANCER",
      cover_letter: "pitch",
      bid_amount_cents: 50000,
      duration: "1 week",
      screening_answers: [],
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from connects where freelancer_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const submitInput = (jobId: string) => ({
  jobId,
  coverLetter: "A cover letter long enough for the test.",
  bidAmountCents: 50000,
  duration: "1 week",
  screeningAnswers: [],
});

const businessState = async (fixture: Fixture) => {
  const result = await pool.query(
    `select
      (select count(*)::int from proposals where job_id = $1) as proposals,
      (select connects from connects
        where freelancer_id = $2 or agency_id = $3) as connects,
      (select count(*)::int from connects_history h
        join connects c on c.id = h.connects_id
        where c.freelancer_id = $2 or c.agency_id = $3) as history`,
    [fixture.jobId, fixture.freelancerId, fixture.agencyId],
  );
  return result.rows[0] as {
    proposals: number;
    connects: number;
    history: number;
  };
};

interface TransactionSite {
  name: string;
  senderType: "FREELANCER" | "AGENCY";
  run: (fixture: Fixture) => Promise<string>;
}

const transactionSites: TransactionSite[] = [
  {
    name: "submitProposal (PROPOSAL_RECEIVED)",
    senderType: "FREELANCER",
    run: async (fixture) =>
      (await submitProposal(fixture.freelancerId, submitInput(fixture.jobId)))
        .proposal.id,
  },
  {
    name: "submitAgencyProposal (PROPOSAL_RECEIVED)",
    senderType: "AGENCY",
    run: async (fixture) =>
      (
        await submitAgencyProposal(
          fixture.agencyId!,
          submitInput(fixture.jobId),
        )
      ).proposal.id,
  },
];

const receivedId = (proposalId: string) =>
  notificationEventId("PROPOSAL_RECEIVED", proposalId, "received");

const viewedId = (proposalId: string) =>
  notificationEventId("PROPOSAL_VIEWED", proposalId, "viewed");

const sentInputs = () =>
  mocks.sendNotification.mock.calls.map(
    ([input]) => input as Record<string, unknown>,
  );

const expectModeOutcome = async (
  mode: (typeof OUTBOX_MODES)[number],
  eventId: string,
) => {
  const sent = sentInputs();
  const rows = await outboxRows([eventId]);
  if (mode === "on") {
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  } else {
    expect(sent.map((input) => input.eventId)).toEqual([eventId]);
  }
  if (mode === "off") {
    expect(rows).toEqual([]);
    return;
  }
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe("PENDING");
  if (mode === "shadow")
    expect(rows[0]!.payload).toEqual(withoutEventId(sent[0]!));
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await deleteOutboxRows(touchedEventIds);
  await purge();
  resetOutboxMode();
  await pool.end();
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.failAfterInsert = false;
  mocks.failInsert = false;
  mocks.warn.mockReset();
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue("published");
});

afterEach(async () => {
  resetOutboxMode();
  await deleteOutboxRows(touchedEventIds);
});

describe.each(transactionSites)("$name", (site) => {
  it.each(OUTBOX_MODES)(
    "mode %s: direct send and outbox row follow the mode",
    async (mode) => {
      setOutboxMode(mode);
      const fixture = await seed(site.senderType);

      const proposalId = await site.run(fixture);
      const eventId = receivedId(proposalId);
      touchedEventIds.push(eventId);

      await expectModeOutcome(mode, eventId);
    },
  );

  it("mode on: a committed submission leaves exactly one row", async () => {
    setOutboxMode("on");
    const fixture = await seed(site.senderType);

    const eventId = receivedId(await site.run(fixture));
    touchedEventIds.push(eventId);

    expect(await outboxRows([eventId])).toHaveLength(1);
  });

  it("mode on: a rolled-back submission leaves no outbox row, no proposal and no debit", async () => {
    setOutboxMode("on");
    const fixture = await seed(site.senderType);
    const before = await businessState(fixture);
    mocks.failAfterInsert = true;

    await expect(site.run(fixture)).rejects.toThrow("injected failure");

    const leftovers = (
      await pool.query<{ event_id: string }>(
        "select event_id from outbox_events where payload->'metadata'->>'jobId' = $1",
        [fixture.jobId],
      )
    ).rows.map((row) => row.event_id);
    touchedEventIds.push(...leftovers);
    expect(leftovers).toEqual([]);
    expect(await businessState(fixture)).toEqual(before);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

describe("markProposalViewed (PROPOSAL_VIEWED, enqueued after the write)", () => {
  it.each(OUTBOX_MODES)(
    "mode %s: direct send and outbox row follow the mode",
    async (mode) => {
      setOutboxMode(mode);
      const fixture = await seed("FREELANCER");
      const proposalId = await insertSubmittedProposal(fixture);
      const eventId = viewedId(proposalId);
      touchedEventIds.push(eventId);

      await markProposalViewed(proposalId, fixture.clientId);

      await expectModeOutcome(mode, eventId);
    },
  );

  it("mode on: a failed enqueue keeps the VIEWED status, logs and sends directly", async () => {
    setOutboxMode("on");
    const fixture = await seed("AGENCY");
    const proposalId = await insertSubmittedProposal(fixture);
    const eventId = viewedId(proposalId);
    touchedEventIds.push(eventId);
    mocks.failInsert = true;

    const result = await markProposalViewed(proposalId, fixture.clientId);

    expect(result.status).toBe("VIEWED");
    expect(await outboxRows([eventId])).toEqual([]);
    expect(sentInputs().map((input) => input.eventId)).toEqual([eventId]);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "outbox.enqueue.failed" }),
    );
  });

  it("mode on: a repeat view enqueues nothing new", async () => {
    setOutboxMode("on");
    const fixture = await seed("FREELANCER");
    const proposalId = await insertSubmittedProposal(fixture);
    const eventId = viewedId(proposalId);
    touchedEventIds.push(eventId);

    await markProposalViewed(proposalId, fixture.clientId);
    await markProposalViewed(proposalId, fixture.clientId);

    expect(await outboxRows([eventId])).toHaveLength(1);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
