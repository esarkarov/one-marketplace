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
  emitConversationUpdate: vi.fn(),
  failAfterInsert: false,
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env } };
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
        const inserted = await original.insertOutboxEvent(...args);
        if (mocks.failAfterInsert) throw new Error("injected failure");
        return inserted;
      },
    };
  },
);

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "@/database/client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import {
  acceptOffer,
  finishContractAsParty,
} from "@/modules/contracts/services/contracts.lifecycle.service.js";
import { addContractMilestone } from "@/modules/contracts/services/contracts.milestones.service.js";
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
import {
  OUTBOX_MODES,
  currentMode,
  deleteOutboxRows,
  outboxRows,
  resetOutboxMode,
  setOutboxMode,
  withoutEventId,
} from "@/test/support/outbox-mode.js";

const PREFIX = "contracts-outbox-it-";
const AMOUNT = 20000;

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const touchedEventIds: string[] = [];

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    display_name: "Test User",
    role,
    identityVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const seed = async (options: {
  contractStatus: "PENDING" | "ACTIVE";
  milestone: { status: "PENDING" | "ACTIVE" | "COMPLETED"; funded: boolean };
  agency?: boolean;
}) => {
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
        overview: "contracts outbox agency",
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
      title: "Outbox job",
      description: "Outbox test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: AMOUNT,
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
      cover_letter: "outbox test",
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
      title: "Outbox contract",
      total_amount_cents: AMOUNT,
      status: options.contractStatus,
      started_at: options.contractStatus === "PENDING" ? null : new Date(),
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
  await db.insert(contract_milestones).values({
    contract_id: contract!.id,
    title: "Milestone 1",
    amount_cents: AMOUNT,
    due_date: "2026-12-01",
    position: 0,
    status: options.milestone.status,
    funded_at: options.milestone.funded ? new Date() : null,
    completed_at: options.milestone.status === "COMPLETED" ? new Date() : null,
  });
  return { clientId, ownerId, agencyId, contractId: contract!.id };
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

const businessState = async (fixture: Fixture) => {
  const result = await pool.query(
    `select
      c.status as contract,
      p.status as proposal,
      j.status as job,
      (select json_agg(json_build_object('status', m.status, 'funded', m.funded_at is not null) order by m.position)
        from contract_milestones m where m.contract_id = c.id) as milestones,
      (select count(*)::int from reviews r where r.contract_id = c.id) as reviews,
      (select count(*)::int from messages msg
        join conversations conv on conv.id = msg.conversation_id
        where conv.proposal_id = c.proposal_id) as messages,
      c.total_amount_cents::text as total
    from contracts c
    join proposals p on p.id = c.proposal_id
    join job_posts j on j.id = c.job_id
    where c.id = $1`,
    [fixture.contractId],
  );
  return result.rows[0] as Record<string, unknown>;
};

interface Site {
  name: string;
  seed: () => Promise<Fixture>;
  run: (fixture: Fixture) => Promise<string[]>;
}

const acceptedIds = (contractId: string) => [
  notificationEventId("CONTRACT_ACCEPTED", contractId, "accepted-client"),
  notificationEventId("CONTRACT_ACCEPTED", contractId, "accepted-talent"),
];

const sites: Site[] = [
  {
    name: "acceptOffer (CONTRACT_ACCEPTED, two notices)",
    seed: () =>
      seed({
        contractStatus: "PENDING",
        milestone: { status: "PENDING", funded: true },
      }),
    run: async (fixture) => {
      await acceptOffer(fixture.ownerId, fixture.contractId, undefined);
      return acceptedIds(fixture.contractId);
    },
  },
  {
    name: "acceptOffer for an agency (CONTRACT_ACCEPTED, two notices)",
    seed: () =>
      seed({
        agency: true,
        contractStatus: "PENDING",
        milestone: { status: "PENDING", funded: true },
      }),
    run: async (fixture) => {
      await acceptOffer(fixture.ownerId, fixture.contractId, "agency");
      return acceptedIds(fixture.contractId);
    },
  },
  {
    name: "finishContractAsParty (CONTRACT_COMPLETED)",
    seed: () =>
      seed({
        contractStatus: "ACTIVE",
        milestone: { status: "COMPLETED", funded: true },
      }),
    run: async (fixture) => {
      await finishContractAsParty(
        fixture.clientId,
        "client",
        fixture.contractId,
        undefined,
        5,
        "Great collaboration, would hire again.",
      );
      return [
        notificationEventId(
          "CONTRACT_COMPLETED",
          fixture.contractId,
          "completed",
        ),
      ];
    },
  },
  {
    name: "finishContractAsParty for an agency (CONTRACT_COMPLETED)",
    seed: () =>
      seed({
        agency: true,
        contractStatus: "ACTIVE",
        milestone: { status: "COMPLETED", funded: true },
      }),
    run: async (fixture) => {
      await finishContractAsParty(
        fixture.clientId,
        "client",
        fixture.contractId,
        undefined,
        5,
        "Great collaboration, would hire again.",
      );
      return [
        notificationEventId(
          "CONTRACT_COMPLETED",
          fixture.contractId,
          "completed",
        ),
      ];
    },
  },
  {
    name: "finishContractAsParty, second review (REVIEW_RECEIVED)",
    seed: async () => {
      const fixture = await seed({
        contractStatus: "ACTIVE",
        milestone: { status: "COMPLETED", funded: true },
      });
      const mode = currentMode();
      setOutboxMode("off");
      await finishContractAsParty(
        fixture.clientId,
        "client",
        fixture.contractId,
        undefined,
        5,
        "Great collaboration, would hire again.",
      );
      setOutboxMode(mode);
      mocks.sendNotification.mockClear();
      return fixture;
    },
    run: async (fixture) => {
      await finishContractAsParty(
        fixture.ownerId,
        "freelancer",
        fixture.contractId,
        undefined,
        5,
        "A clear and responsive client to work with.",
      );
      return [
        notificationEventId(
          "REVIEW_RECEIVED",
          fixture.contractId,
          "review-freelancer",
        ),
      ];
    },
  },
  {
    name: "addContractMilestone (MILESTONE_ADDED)",
    seed: () =>
      seed({
        contractStatus: "ACTIVE",
        milestone: { status: "COMPLETED", funded: true },
      }),
    run: async (fixture) => {
      const added = await addContractMilestone(
        fixture.contractId,
        fixture.clientId,
        { title: "Extra milestone", amountCents: 15000, dueDate: "2026-12-15" },
      );
      return [notificationEventId("MILESTONE_ADDED", added.id, "added")];
    },
  },
];

const sentInputs = () =>
  mocks.sendNotification.mock.calls.map(
    ([input]) => input as Record<string, unknown>,
  );

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
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue("published");
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
});

afterEach(async () => {
  resetOutboxMode();
  await deleteOutboxRows(touchedEventIds);
});

describe.each(sites)("$name", (site) => {
  it.each(OUTBOX_MODES)(
    "mode %s: direct send and outbox row follow the mode",
    async (mode) => {
      setOutboxMode(mode);
      const fixture = await site.seed();

      const eventIds = await site.run(fixture);
      touchedEventIds.push(...eventIds);

      const sent = sentInputs();
      const rows = await outboxRows(eventIds);
      if (mode === "on") {
        expect(mocks.sendNotification).not.toHaveBeenCalled();
      } else {
        expect(sent.map((input) => input.eventId)).toEqual(eventIds);
      }
      if (mode === "off") {
        expect(rows).toEqual([]);
        return;
      }
      expect(rows.map((row) => row.event_id).sort()).toEqual(
        [...eventIds].sort(),
      );
      for (const row of rows) expect(row.status).toBe("PENDING");
      if (mode === "shadow") {
        for (const input of sent) {
          const row = rows.find((item) => item.event_id === input.eventId);
          expect(row?.payload).toEqual(withoutEventId(input));
        }
      }
    },
  );

  it("mode on: a committed business transaction leaves exactly one row per notice", async () => {
    setOutboxMode("on");
    const fixture = await site.seed();

    const eventIds = await site.run(fixture);
    touchedEventIds.push(...eventIds);

    const rows = await outboxRows(eventIds);
    expect(rows).toHaveLength(eventIds.length);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(rows.length);
  });

  it("mode on: a rolled-back business transaction leaves no outbox row and no business change", async () => {
    setOutboxMode("on");
    const fixture = await site.seed();
    const before = await businessState(fixture);
    mocks.failAfterInsert = true;

    await expect(site.run(fixture)).rejects.toThrow("injected failure");

    const leftovers = (
      await pool.query<{ event_id: string }>(
        `select event_id from outbox_events
         where payload->'metadata'->>'contractId' = $1`,
        [fixture.contractId],
      )
    ).rows.map((row) => row.event_id);
    touchedEventIds.push(...leftovers);
    expect(leftovers).toEqual([]);
    expect(await businessState(fixture)).toEqual(before);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

describe("outbox insert failure inside a business transaction", () => {
  it("mode shadow: an outbox insert failure rolls back the contract acceptance", async () => {
    setOutboxMode("shadow");
    const fixture = await seed({
      contractStatus: "PENDING",
      milestone: { status: "PENDING", funded: true },
    });
    mocks.failAfterInsert = true;

    await expect(
      acceptOffer(fixture.ownerId, fixture.contractId, undefined),
    ).rejects.toThrow("injected failure");

    expect((await businessState(fixture)).contract).toBe("PENDING");
    expect(await outboxRows(acceptedIds(fixture.contractId))).toEqual([]);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
