import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  emitConversationUpdate: vi.fn(),
  failAfterWrite: false,
  loggerWarn: vi.fn(),
  createDailyRoom: vi.fn(),
}));

vi.mock("../../config/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/logger.js")>();
  return {
    ...original,
    logger: { ...original.logger, warn: mocks.loggerWarn },
  };
});

vi.mock("../../infrastructure/daily.js", () => ({
  createDailyRoom: mocks.createDailyRoom,
}));

vi.mock("../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

vi.mock("../messaging/messaging.service.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../messaging/messaging.service.js")>();
  const post = original.postSystemEventMessage as (
    ...args: unknown[]
  ) => Promise<unknown>;
  return {
    ...original,
    postSystemEventMessage: async (...args: unknown[]) => {
      const result = await post(...args);
      if (mocks.failAfterWrite) throw new Error("message insert failed");
      return result;
    },
  };
});

import { db, pool } from "../../database/client.js";
import {
  accounts,
  conversation_participants,
  conversations,
  meetings,
  messages,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  raceBlocked,
  waitForBlocked,
  type LockHolder,
} from "../../test/support/lock-holder.js";
import { startMeeting } from "./meetings.service.js";

const PREFIX = "meeting-start-it-";
const INSERT_MEETING = 'insert into "meetings"%';

const accountIds: string[] = [];
const conversationIds: string[] = [];
const createdRooms: string[] = [];

const purgeLeftovers = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const countLeftovers = async () => {
  const like = `${PREFIX}%`;
  const result = await pool.query<{ total: string }>(
    `select (
       (select count(*) from accounts where auth_id like $1) +
       (select count(*) from conversations where context_key like $1)
     )::text as total`,
    [like],
  );
  return Number(result.rows[0]?.total ?? 0);
};

const createFixture = async () => {
  const authIds = [0, 1].map(() => `${PREFIX}${randomUUID()}`);
  for (const [index, authId] of authIds.entries()) {
    await db.insert(accounts).values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role: index === 0 ? "CLIENT" : "FREELANCER",
      created_at: new Date(),
      updated_at: new Date(),
    });
    accountIds.push(authId);
  }

  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: `${PREFIX}${randomUUID()}` })
    .returning({ id: conversations.id });
  conversationIds.push(conversation!.id);

  await db.insert(conversation_participants).values(
    authIds.map((authId, index) => ({
      conversation_id: conversation!.id,
      account_id: authId,
      participant_type: index === 0 ? "CLIENT" : "FREELANCER",
    })),
  );

  return { conversationId: conversation!.id, actorId: authIds[0]! };
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const readState = async (fixture: Fixture) => {
  const meetingRows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.conversation_id, fixture.conversationId));
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, fixture.conversationId));
  return {
    meetingRows,
    active: meetingRows.filter((row) => row.status === "ACTIVE"),
    messageRows,
  };
};

const holdUncommittedMeeting =
  (fixture: Fixture, roomName: string) =>
  async (client: import("pg").PoolClient) => {
    await client.query(
      `insert into meetings
         (conversation_id, provider_room_name, join_url, started_by_account_id, status)
       values ($1, $2, $3, $4, 'ACTIVE')`,
      [
        fixture.conversationId,
        roomName,
        `https://example.test/${roomName}`,
        fixture.actorId,
      ],
    );
  };

const orphanWarns = () =>
  mocks.loggerWarn.mock.calls
    .map(([entry]) => entry as { eventName?: string; attributes?: unknown })
    .filter((entry) => entry.eventName === "task.meeting.room_orphaned");

const orphanRoomNames = () =>
  orphanWarns()
    .map(
      (entry) =>
        (entry.attributes as Record<string, unknown>)["task.meeting.room_name"],
    )
    .sort();

const warnsFor = (eventName: string) =>
  mocks.loggerWarn.mock.calls
    .map(([entry]) => entry as { eventName?: string })
    .filter((entry) => entry.eventName === eventName);

let fixture: Fixture;

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purgeLeftovers();
});

afterAll(async () => {
  const leftovers = await countLeftovers();
  await pool.end();
  expect(leftovers).toBe(0);
});

beforeEach(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.failAfterWrite = false;
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.loggerWarn.mockReset();
  mocks.loggerWarn.mockResolvedValue(undefined);
  createdRooms.length = 0;
  mocks.createDailyRoom.mockReset();
  mocks.createDailyRoom.mockImplementation(async (name: string) => {
    createdRooms.push(name);
    return {
      id: `room-${name}`,
      name,
      url: `https://example.test/${name}`,
      created_at: new Date().toISOString(),
    };
  });
  fixture = await createFixture();
});

afterEach(async () => {
  if (conversationIds.length > 0) {
    await db
      .delete(conversations)
      .where(inArray(conversations.id, conversationIds.splice(0)));
  }
  if (accountIds.length > 0) {
    await db
      .delete(accounts)
      .where(inArray(accounts.auth_id, accountIds.splice(0)));
  }
});

const start = () => startMeeting(fixture.conversationId, fixture.actorId);

describe("startMeeting against real Postgres", () => {
  it("returns the committed holder meeting to two racing starts without a message or emit", async () => {
    const holderRoom = `${PREFIX}holder-${randomUUID()}`;
    const client = await pool.connect();
    let holder: LockHolder | undefined;
    let committed = false;
    try {
      await client.query("begin");
      await holdUncommittedMeeting(fixture, holderRoom)(client);
      const pidResult = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      holder = { pid: pidResult.rows[0]!.pid, release: async () => undefined };

      const pending = Promise.all([start(), start()]);
      expect(await waitForBlocked(holder.pid, 2, INSERT_MEETING)).toBe(2);
      await client.query("commit");
      committed = true;
      const [first, second] = await pending;

      const state = await readState(fixture);
      expect(state.active).toHaveLength(1);
      expect(state.meetingRows).toHaveLength(1);
      const holderMeeting = state.active[0]!;
      expect(holderMeeting.provider_room_name).toBe(holderRoom);
      expect(first!.id).toBe(holderMeeting.id);
      expect(second!.id).toBe(holderMeeting.id);
      expect(first!.joinUrl).toBe(holderMeeting.join_url);
      expect(state.messageRows).toHaveLength(0);
      expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
      expect(createdRooms).toHaveLength(2);
      expect(orphanWarns()).toHaveLength(2);
      expect(orphanRoomNames()).toEqual([...createdRooms].sort());
      for (const entry of orphanWarns()) {
        expect(entry.attributes).toMatchObject({
          "task.conversation.id": fixture.conversationId,
        });
      }
    } finally {
      if (!committed) await client.query("rollback");
      client.release();
    }
  }, 30000);

  it("lets exactly one blocked start win after the holder rolls back", async () => {
    const results = await raceBlocked<{ id: string; joinUrl: string }>({
      hold: holdUncommittedMeeting(fixture, `${PREFIX}holder-${randomUUID()}`),
      queryPattern: INSERT_MEETING,
      starts: [start, start],
    });

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    const [first, second] = results.map(
      (result) => (result as PromiseFulfilledResult<{ id: string }>).value,
    );
    expect(first!.id).toBe(second!.id);

    const state = await readState(fixture);
    expect(state.meetingRows).toHaveLength(1);
    expect(state.active).toHaveLength(1);
    expect(state.active[0]!.id).toBe(first!.id);
    expect(state.messageRows).toHaveLength(1);
    expect(state.messageRows[0]!.event_type).toBe("MEETING_STARTED");
    expect(state.active[0]!.message_id).toBe(state.messageRows[0]!.id);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(createdRooms).toHaveLength(2);
    const loserRoom = createdRooms.find(
      (name) => name !== state.active[0]!.provider_room_name,
    );
    expect(orphanRoomNames()).toEqual([loserRoom]);
  }, 30000);

  it("emits only after commit and exactly once for the winner", async () => {
    let visibleAtEmit: { meeting: boolean; message: boolean } | undefined;
    mocks.emitConversationUpdate.mockImplementation(async () => {
      const state = await readState(fixture);
      visibleAtEmit = {
        meeting: state.active.length === 1,
        message: state.messageRows.length === 1,
      };
    });

    const result = await start();

    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      fixture.actorId,
    );
    expect(visibleAtEmit).toEqual({ meeting: true, message: true });
    const state = await readState(fixture);
    expect(state.active[0]!.id).toBe(result.id);
    expect(orphanWarns()).toHaveLength(0);
  });

  it("removes the meeting, propagates the error, names the orphan room and does not emit when the message insert fails", async () => {
    mocks.failAfterWrite = true;

    await expect(start()).rejects.toThrow("message insert failed");

    const state = await readState(fixture);
    expect(state.meetingRows).toHaveLength(0);
    expect(state.messageRows).toHaveLength(0);
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    expect(createdRooms).toHaveLength(1);
    expect(orphanRoomNames()).toEqual(createdRooms);
  });

  it("succeeds and logs emit_failed when the post-commit emit fails", async () => {
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const result = await start();

    const state = await readState(fixture);
    expect(state.active).toHaveLength(1);
    expect(state.active[0]!.id).toBe(result.id);
    expect(state.messageRows).toHaveLength(1);
    expect(warnsFor("task.meeting.emit_failed")).toHaveLength(1);
    expect(orphanWarns()).toHaveLength(0);
  });

  it("returns the existing active meeting without creating a Daily room", async () => {
    const [existing] = await db
      .insert(meetings)
      .values({
        conversation_id: fixture.conversationId,
        provider_room_name: `${PREFIX}existing-${randomUUID()}`,
        join_url: "https://example.test/existing",
        started_by_account_id: fixture.actorId,
        status: "ACTIVE",
      })
      .returning();

    const result = await start();

    expect(result).toEqual({
      id: existing!.id,
      joinUrl: existing!.join_url,
      startedAt: existing!.started_at,
    });
    expect(mocks.createDailyRoom).not.toHaveBeenCalled();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
    const state = await readState(fixture);
    expect(state.messageRows).toHaveLength(0);
    expect(
      (
        await db
          .select()
          .from(meetings)
          .where(
            and(
              eq(meetings.conversation_id, fixture.conversationId),
              eq(meetings.status, "ACTIVE"),
            ),
          )
      ).length,
    ).toBe(1);
  });
});
