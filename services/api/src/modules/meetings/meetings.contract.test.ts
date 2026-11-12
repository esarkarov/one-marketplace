import { randomUUID } from "node:crypto";
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
  createDailyRoom: vi.fn(),
  emitConversationUpdate: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/daily.js", () => ({
  createDailyRoom: mocks.createDailyRoom,
}));

vi.mock("../../infrastructure/redis.js", () => ({
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

vi.mock("../messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  conversation_participants,
  conversations,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { meetingsResponses } from "./meetings.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "meetings-contract-it-";
const API = "/api/v1/conversations";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const seed = async () => {
  const authIds = [0, 1].map(() => `${PREFIX}${randomUUID()}`);
  for (const [index, authId] of authIds.entries()) {
    await db.insert(accounts).values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role: index === 0 ? "CLIENT" : "FREELANCER",
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  const [conversation] = await db
    .insert(conversations)
    .values({ context_key: `${PREFIX}${randomUUID()}` })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values(
    authIds.map((authId, index) => ({
      conversation_id: conversation!.id,
      account_id: authId,
      participant_type: index === 0 ? "CLIENT" : "FREELANCER",
    })),
  );
  return { conversationId: conversation!.id, clientId: authIds[0]! };
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
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
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.store.clear();
  mocks.verifyToken.mockReset();
  mocks.createDailyRoom.mockReset();
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.createDailyRoom.mockImplementation(async (name: string) => ({
    name,
    url: `https://daily.test/${name}`,
  }));
});

describe("POST /conversations/:conversationId/meetings", () => {
  it("matches the 201 schema, new and existing meeting", async () => {
    const fixture = await seed();
    const created = await request(app)
      .post(`${API}/${fixture.conversationId}/meetings`)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({});
    expect(created.status).toBe(201);
    const first = meetingsResponses.create[201].parse(created.body);

    const existing = await request(app)
      .post(`${API}/${fixture.conversationId}/meetings`)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({});
    expect(existing.status).toBe(201);
    const second = meetingsResponses.create[201].parse(existing.body);
    expect(second.data.id).toBe(first.data.id);
    expect(mocks.createDailyRoom).toHaveBeenCalledTimes(1);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(`${API}/${randomUUID()}/meetings`)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({});
    expect(response.status).toBe(404);
    meetingsResponses.create[404].parse(response.body);
  });
});
