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
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

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

import { db, pool } from "../../database/client.js";
import { accounts, notifications } from "../../database/schema.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { notificationsResponses } from "./notifications.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "notifications-contract-it-";
const API = "/api/v1/notifications";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const seed = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
  });
  const rows = await db
    .insert(notifications)
    .values([
      {
        event_id: `${PREFIX}${randomUUID()}`,
        recipient_id: authId,
        type: "CONTRACT_OFFER",
        title: "New contract offer",
        message: "A client sent you a contract offer.",
        link: "/messages?conversationId=abc",
        metadata: { contractId: randomUUID() },
      },
      {
        event_id: `${PREFIX}${randomUUID()}`,
        recipient_id: authId,
        type: "MILESTONE_FUNDED",
        title: "Milestone funded",
        message: "The client funded a milestone.",
      },
    ])
    .returning({ id: notifications.id });
  return { authId, notificationIds: rows.map((row) => row.id) };
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from notifications where event_id like $1", [like]);
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
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
});

describe("GET /notifications", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(fixture.authId));
    expect(response.status).toBe(200);
    const body = notificationsResponses.list[200].parse(response.body);
    expect(body.data).toHaveLength(2);
  });

  it("matches the 200 schema for an empty agency scope", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(API)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(fixture.authId));
    expect(response.status).toBe(200);
    notificationsResponses.list[200].parse(response.body);
  });
});

describe("PATCH /notifications/read-all", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .patch(`${API}/read-all`)
      .query({ role: "freelancer" })
      .set(as(fixture.authId));
    expect(response.status).toBe(200);
    notificationsResponses.readAll[200].parse(response.body);

    const list = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(fixture.authId));
    const body = notificationsResponses.list[200].parse(list.body);
    expect(body.data.every((item) => item.is_read && item.read_at)).toBe(true);
  });
});

describe("PATCH /notifications/:notificationId/read", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .patch(`${API}/${fixture.notificationIds[0]}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.authId));
    expect(response.status).toBe(200);
    notificationsResponses.read[200].parse(response.body);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .patch(`${API}/${randomUUID()}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.authId));
    expect(response.status).toBe(404);
    notificationsResponses.read[404].parse(response.body);
  });
});
