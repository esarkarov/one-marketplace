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

vi.mock("@/infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("@/infrastructure/cache/account-auth.cache.js", () => ({
  invalidateAccountAuthCache: async () => undefined,
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
        return original.insertOutboxEvent(...args);
      },
    };
  },
);

import { db, pool } from "@/database/client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import { respondToAgencyInvitation } from "@/modules/agency/services/agency.invitations.service.js";
import {
  createAgency,
  updateAgencyProfile,
} from "@/modules/agency/services/agency.profile.service.js";
import { accounts, agency_invitations } from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  OUTBOX_MODES,
  deleteOutboxRows,
  outboxRows,
  resetOutboxMode,
  setOutboxMode,
  withoutEventId,
} from "@/test/support/outbox-mode.js";

const PREFIX = "agency-outbox-it-";
const touchedEventIds: string[] = [];

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async () => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const newAgency = async () => {
  const ownerId = await insertAccount();
  const agency = await createAgency({
    ownerId,
    name: `${PREFIX}agency`,
    size: "2-10",
    specialty: "Testing",
    overview: "Outbox test agency.",
  });
  return { ownerId, agencyId: agency.id };
};

const newInvitation = async () => {
  const { ownerId, agencyId } = await newAgency();
  const inviteeId = await insertAccount();
  const [invitation] = await db
    .insert(agency_invitations)
    .values({
      agency_id: agencyId,
      email: `${inviteeId}@example.test`,
      invited_by: ownerId,
    })
    .returning({ id: agency_invitations.id });
  return { agencyId, inviteeId, invitationId: invitation!.id };
};

const onboard = (ownerId: string) =>
  updateAgencyProfile({
    ownerId,
    name: `${PREFIX}agency`,
    professionalTitle: "Testing agency",
    size: "2-10",
    specialty: "Testing",
    overview: "Outbox test agency.",
    tags: ["testing"],
    portfolio: [],
  });

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from agency_members where freelancer_id like $1", [
    like,
  ]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const sentInputs = () =>
  mocks.sendNotification.mock.calls.map(
    ([input]) => input as Record<string, unknown>,
  );

const expectModeOutcome = async (
  mode: (typeof OUTBOX_MODES)[number],
  eventId: string,
  expected: Record<string, unknown>,
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
  expect(rows[0]!.payload).toMatchObject(expected);
  if (mode === "shadow") {
    expect(rows[0]!.payload).toEqual(withoutEventId(sent[0]!));
  }
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
  mocks.failInsert = false;
  mocks.warn.mockReset();
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue("published");
});

afterEach(async () => {
  resetOutboxMode();
  await deleteOutboxRows(touchedEventIds);
});

describe.each([
  { accept: true, transition: "accepted", type: "AGENCY_INVITATION_ACCEPTED" },
  { accept: false, transition: "declined", type: "AGENCY_INVITATION_DECLINED" },
])(
  "respondToAgencyInvitation, $type (enqueued after the write)",
  ({ accept, transition, type }) => {
    it.each(OUTBOX_MODES)(
      "mode %s: direct send and outbox row follow the mode",
      async (mode) => {
        const fixture = await newInvitation();
        setOutboxMode(mode);
        const eventId = notificationEventId(
          type,
          fixture.invitationId,
          transition,
        );
        touchedEventIds.push(eventId);

        await respondToAgencyInvitation(
          fixture.invitationId,
          fixture.inviteeId,
          accept,
        );

        await expectModeOutcome(mode, eventId, {
          agencyId: fixture.agencyId,
          type,
          link: "/team",
          metadata: { invitationId: fixture.invitationId },
        });
      },
    );

    it("mode on: a failed enqueue keeps the answer, logs and sends directly", async () => {
      const fixture = await newInvitation();
      setOutboxMode("on");
      const eventId = notificationEventId(
        type,
        fixture.invitationId,
        transition,
      );
      touchedEventIds.push(eventId);
      mocks.failInsert = true;

      await expect(
        respondToAgencyInvitation(
          fixture.invitationId,
          fixture.inviteeId,
          accept,
        ),
      ).resolves.toEqual({ accepted: accept });

      const status = await pool.query(
        "select status from agency_invitations where id = $1",
        [fixture.invitationId],
      );
      expect(status.rows[0].status).not.toBe("PENDING");
      expect(await outboxRows([eventId])).toEqual([]);
      expect(sentInputs().map((input) => input.eventId)).toEqual([eventId]);
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "outbox.enqueue.failed" }),
      );
    });
  },
);

describe("updateAgencyProfile onboarding, AGENCY_WELCOME_BONUS (enqueued after the grant)", () => {
  it.each(OUTBOX_MODES)(
    "mode %s: direct send and outbox row follow the mode",
    async (mode) => {
      const { ownerId, agencyId } = await newAgency();
      setOutboxMode(mode);
      const eventId = notificationEventId(
        "AGENCY_WELCOME_BONUS",
        agencyId,
        "welcome-bonus",
      );
      touchedEventIds.push(eventId);

      await onboard(ownerId);

      await expectModeOutcome(mode, eventId, {
        agencyId,
        type: "AGENCY_WELCOME_BONUS",
        link: "/finances?section=connects",
        metadata: { connects: expect.any(Number) },
      });
    },
  );

  it("mode on: a failed enqueue keeps the grant, logs and sends directly", async () => {
    const { ownerId, agencyId } = await newAgency();
    setOutboxMode("on");
    const eventId = notificationEventId(
      "AGENCY_WELCOME_BONUS",
      agencyId,
      "welcome-bonus",
    );
    touchedEventIds.push(eventId);
    mocks.failInsert = true;

    await onboard(ownerId);

    const balance = await pool.query(
      "select connects from connects where agency_id = $1",
      [agencyId],
    );
    expect(balance.rows).toHaveLength(1);
    expect(await outboxRows([eventId])).toEqual([]);
    expect(sentInputs().map((input) => input.eventId)).toEqual([eventId]);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "outbox.enqueue.failed" }),
    );
  });
});
