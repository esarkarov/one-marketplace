import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
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
  secret: Buffer.from("meeting-it-webhook-secret").toString("base64"),
  emitConversationUpdate: vi.fn(),
  failAfterWrite: false,
  store: new Map<string, string>(),
  redisDel: vi.fn(),
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

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: { ...original.env, dailyWebhookSecret: mocks.secret },
  };
});

vi.mock("../../config/redis.js", () => ({
  redis: {
    isReady: true,
    set: async (key: string, value: string) => {
      if (mocks.store.has(key)) return null;
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      mocks.redisDel(key);
      mocks.store.delete(key);
      return 1;
    },
  },
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
import { errorHandler } from "../../middleware/error.middleware.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { dailyWebhookHandler } from "./meetings.controller.js";
import { endMeetingByRoomName } from "./meetings.service.js";

const PREFIX = "meeting-it-";

const accountIds: string[] = [];
const conversationIds: string[] = [];

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
  const authIds = [0, 1, 2].map(() => `${PREFIX}${randomUUID()}`);
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

  const roomName = `${PREFIX}room-${randomUUID()}`;
  const [meeting] = await db
    .insert(meetings)
    .values({
      conversation_id: conversation!.id,
      provider_room_name: roomName,
      join_url: `https://example.test/${roomName}`,
      started_by_account_id: authIds[0]!,
      status: "ACTIVE",
      started_at: new Date(Date.now() - 10 * 60_000),
    })
    .returning();

  return {
    conversationId: conversation!.id,
    meetingId: meeting!.id,
    roomName,
    authIds,
  };
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const readState = async (fixture: Fixture) => {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, fixture.meetingId));
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
  return { meeting: meeting!, rows, participants, conversation: conversation! };
};

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
  mocks.store.clear();
  mocks.redisDel.mockReset();
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.loggerWarn.mockReset();
  mocks.loggerWarn.mockResolvedValue(undefined);
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

describe("endMeetingByRoomName against real Postgres", () => {
  it("ends the meeting and posts one message on the normal path", async () => {
    const result = await endMeetingByRoomName(fixture.roomName);

    expect(result).toEqual({
      id: fixture.meetingId,
      conversationId: fixture.conversationId,
      durationMinutes: 10,
    });

    const state = await readState(fixture);
    expect(state.meeting.status).toBe("ENDED");
    expect(state.meeting.ended_at).toBeInstanceOf(Date);
    expect(state.rows).toHaveLength(1);
    const [message] = state.rows;
    expect(message!.message_type).toBe("SYSTEM_EVENT");
    expect(message!.event_type).toBe("MEETING_ENDED");
    expect(message!.event_payload).toEqual({
      meetingId: fixture.meetingId,
      durationMinutes: 10,
    });
    expect(state.conversation.last_message_id).toBe(message!.id);
    expect(state.conversation.last_message_at).toEqual(message!.created_at);
    expect(state.participants).toHaveLength(3);
    for (const participant of state.participants) {
      expect(participant.unread_count).toBe(1);
    }
  });

  it("lets exactly one of two parallel ends post a message", async () => {
    const results = await Promise.all([
      endMeetingByRoomName(fixture.roomName),
      endMeetingByRoomName(fixture.roomName),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);

    const state = await readState(fixture);
    expect(state.meeting.status).toBe("ENDED");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.event_type).toBe("MEETING_ENDED");
    for (const participant of state.participants) {
      expect(participant.unread_count).toBe(1);
    }
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
  });

  it("treats a repeated sequential end as a no-op", async () => {
    const first = await endMeetingByRoomName(fixture.roomName);
    const before = await readState(fixture);

    const second = await endMeetingByRoomName(fixture.roomName);
    const after = await readState(fixture);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(after.rows).toHaveLength(1);
    expect(after.meeting.ended_at).toEqual(before.meeting.ended_at);
    expect(after.meeting.updated_at).toEqual(before.meeting.updated_at);
    expect(after.participants.map((p) => p.unread_count)).toEqual(
      before.participants.map((p) => p.unread_count),
    );
    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
  });

  it("returns null for an unknown room", async () => {
    await expect(
      endMeetingByRoomName(`${PREFIX}missing-${randomUUID()}`),
    ).resolves.toBeNull();
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
  });

  it("rolls back the status change when posting the message fails", async () => {
    const before = await readState(fixture);
    mocks.failAfterWrite = true;

    await expect(endMeetingByRoomName(fixture.roomName)).rejects.toThrow(
      "message insert failed",
    );

    const after = await readState(fixture);
    expect(after.meeting.status).toBe("ACTIVE");
    expect(after.meeting.ended_at).toBeNull();
    expect(after.meeting.updated_at).toEqual(before.meeting.updated_at);
    expect(after.rows).toHaveLength(0);
    expect(after.conversation.last_message_id).toBeNull();
    expect(after.participants.every((p) => p.unread_count === 0)).toBe(true);
    expect(mocks.emitConversationUpdate).not.toHaveBeenCalled();
  });

  it("emits only after commit and exactly once", async () => {
    let emittedBeforeCommit = false;
    mocks.emitConversationUpdate.mockImplementation(async () => {
      const state = await readState(fixture);
      emittedBeforeCommit = state.meeting.status !== "ENDED";
    });

    await endMeetingByRoomName(fixture.roomName);

    expect(mocks.emitConversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.emitConversationUpdate).toHaveBeenCalledWith(
      fixture.conversationId,
      undefined,
    );
    expect(emittedBeforeCommit).toBe(false);
  });

  it("does not fail the end when the post-commit emit fails", async () => {
    mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));

    const result = await endMeetingByRoomName(fixture.roomName);

    expect(result?.id).toBe(fixture.meetingId);
    const state = await readState(fixture);
    expect(state.meeting.status).toBe("ENDED");
    expect(state.rows).toHaveLength(1);
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("log down"))],
    [
      "throws",
      () => {
        throw new Error("log broke");
      },
    ],
  ])(
    "still resolves the ended meeting when the emit fails and the logger %s",
    async (_label, behavior) => {
      mocks.emitConversationUpdate.mockRejectedValue(new Error("socket down"));
      mocks.loggerWarn.mockImplementation(behavior);

      const result = await endMeetingByRoomName(fixture.roomName);

      expect(result).toEqual({
        id: fixture.meetingId,
        conversationId: fixture.conversationId,
        durationMinutes: 10,
      });
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
      const state = await readState(fixture);
      expect(state.meeting.status).toBe("ENDED");
      expect(state.rows).toHaveLength(1);
    },
  );
});

describe("Daily webhook with the real service and database", () => {
  const app = express();
  app.use((req, _res, next) => {
    req.logger = {
      warn: async () => undefined,
      info: async () => undefined,
      error: async () => undefined,
    } as unknown as typeof req.logger;
    next();
  });
  app.post("/webhook", express.raw({ type: "*/*" }), dailyWebhookHandler);
  app.use(errorHandler);

  const deliver = (eventId: string, room: string) => {
    const body = JSON.stringify({
      id: eventId,
      type: "meeting.ended",
      payload: { room },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from(mocks.secret, "base64"))
      .update(`${timestamp}.${body}`)
      .digest("base64");
    return request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", timestamp)
      .set("X-Webhook-Signature", signature)
      .send(body);
  };

  it("returns 5xx, releases the claim and succeeds on redelivery", async () => {
    const eventId = `evt_${randomUUID()}`;
    const key = `webhook:daily:${eventId}`;
    mocks.failAfterWrite = true;

    const failed = await deliver(eventId, fixture.roomName);

    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({
      success: false,
      message: "Internal server error.",
    });
    expect(JSON.stringify(failed.body)).not.toContain("message insert failed");
    expect(mocks.redisDel).toHaveBeenCalledWith(key);
    expect(mocks.store.has(key)).toBe(false);

    const afterFailure = await readState(fixture);
    expect(afterFailure.meeting.status).toBe("ACTIVE");
    expect(afterFailure.rows).toHaveLength(0);

    mocks.failAfterWrite = false;
    const retried = await deliver(eventId, fixture.roomName);

    expect(retried.status).toBe(200);
    const afterRetry = await readState(fixture);
    expect(afterRetry.meeting.status).toBe("ENDED");
    expect(afterRetry.rows).toHaveLength(1);
  });

  it("returns 200 for a repeated end under a new event id with no second message", async () => {
    const first = await deliver(`evt_${randomUUID()}`, fixture.roomName);
    const second = await deliver(`evt_${randomUUID()}`, fixture.roomName);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const state = await readState(fixture);
    expect(state.rows).toHaveLength(1);
  });
});
