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
import {
  accounts,
  agency_members,
  agency_metadata,
  notifications,
} from "../../test/support/tables.js";
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

describe("notification scoping against real Postgres", () => {
  const createAccount = async () => {
    const authId = `${PREFIX}${randomUUID()}`;
    await db.insert(accounts).values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role: "FREELANCER",
      created_at: new Date(),
      updated_at: new Date(),
    });
    return authId;
  };

  const createAgency = async (ownerId: string) => {
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "notification scoping test",
      })
      .returning({ id: agency_metadata.id });
    await db
      .insert(agency_members)
      .values({ agency_id: agency!.id, freelancer_id: ownerId, role: "Owner" });
    return agency!.id;
  };

  const notify = async (
    target: { recipientId: string } | { agencyId: string },
    title: string,
    createdAt = new Date(),
  ) => {
    const [row] = await db
      .insert(notifications)
      .values({
        event_id: `${PREFIX}${randomUUID()}`,
        recipient_id: "recipientId" in target ? target.recipientId : null,
        agency_id: "agencyId" in target ? target.agencyId : null,
        type: "CONTRACT_OFFER",
        title,
        message: title,
        created_at: createdAt,
      })
      .returning({ id: notifications.id });
    return row!.id;
  };

  const readState = async (ids: string[]) => {
    const result = await pool.query<{ id: string; is_read: boolean }>(
      "select id, is_read from notifications where id = any($1::uuid[])",
      [ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.is_read]));
  };

  const setup = async () => {
    const userA = await createAccount();
    const userB = await createAccount();
    const userC = await createAccount();
    const agencyA = await createAgency(userA);
    const agencyB = await createAgency(userB);
    const ids = {
      userBRecipient: await notify({ recipientId: userB }, "user b"),
      agencyB: await notify({ agencyId: agencyB }, "agency b"),
      agencyA: await notify({ agencyId: agencyA }, "agency a"),
      userARecipient: await notify({ recipientId: userA }, "user a"),
    };
    return { userA, userB, userC, ids };
  };

  it("lists a user's notifications newest first and nobody else's", async () => {
    const userA = await createAccount();
    const userB = await createAccount();
    await notify({ recipientId: userA }, "oldest", new Date("2024-01-01"));
    await notify({ recipientId: userA }, "middle", new Date("2024-02-01"));
    await notify({ recipientId: userA }, "newest", new Date("2024-03-01"));
    await notify({ recipientId: userB }, "other user", new Date("2024-04-01"));

    const response = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(userA));

    expect(response.status).toBe(200);
    expect(
      response.body.data.map((row: { title: string }) => row.title),
    ).toEqual(["newest", "middle", "oldest"]);
  });

  it("lists only the agency's notifications in agency scope", async () => {
    const fixture = await setup();

    const response = await request(app)
      .get(API)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(fixture.userA));

    expect(response.status).toBe(200);
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([
      fixture.ids.agencyA,
    ]);
  });

  it("marks only the agency's notifications read in agency scope", async () => {
    const fixture = await setup();

    const response = await request(app)
      .patch(`${API}/read-all`)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(fixture.userA));

    expect(response.status).toBe(200);
    const state = await readState(Object.values(fixture.ids));
    expect(state.get(fixture.ids.agencyA)).toBe(true);
    expect(state.get(fixture.ids.agencyB)).toBe(false);
    expect(state.get(fixture.ids.userARecipient)).toBe(false);
    expect(state.get(fixture.ids.userBRecipient)).toBe(false);
  });

  it("marks only the user's own notifications read in the default scope", async () => {
    const fixture = await setup();

    const response = await request(app)
      .patch(`${API}/read-all`)
      .query({ role: "freelancer" })
      .set(as(fixture.userA));

    expect(response.status).toBe(200);
    const state = await readState(Object.values(fixture.ids));
    expect(state.get(fixture.ids.userARecipient)).toBe(true);
    expect(state.get(fixture.ids.agencyA)).toBe(false);
    expect(state.get(fixture.ids.agencyB)).toBe(false);
    expect(state.get(fixture.ids.userBRecipient)).toBe(false);
  });

  it("marks one agency notification read for a member of that agency", async () => {
    const fixture = await setup();

    const response = await request(app)
      .patch(`${API}/${fixture.ids.agencyA}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.userA));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: fixture.ids.agencyA });
    const state = await readState(Object.values(fixture.ids));
    expect(state.get(fixture.ids.agencyA)).toBe(true);
  });

  it("marks one personal notification read and stamps read_at", async () => {
    const fixture = await setup();

    const response = await request(app)
      .patch(`${API}/${fixture.ids.userARecipient}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.userA));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: fixture.ids.userARecipient });
    const { rows } = await pool.query(
      "select is_read, read_at from notifications where id = $1",
      [fixture.ids.userARecipient],
    );
    expect(rows[0].is_read).toBe(true);
    expect(rows[0].read_at).toBeInstanceOf(Date);
  });

  it("answers 404 for another user's or another agency's notification", async () => {
    const fixture = await setup();
    const read = (id: string, userId: string) =>
      request(app)
        .patch(`${API}/${id}/read`)
        .query({ role: "freelancer" })
        .set(as(userId));

    expect((await read(fixture.ids.userBRecipient, fixture.userC)).status).toBe(
      404,
    );
    expect((await read(fixture.ids.userBRecipient, fixture.userA)).status).toBe(
      404,
    );
    expect((await read(fixture.ids.agencyB, fixture.userA)).status).toBe(404);
    expect((await read(fixture.ids.agencyA, fixture.userC)).status).toBe(404);

    const state = await readState(Object.values(fixture.ids));
    expect(state.get(fixture.ids.userBRecipient)).toBe(false);
    expect(state.get(fixture.ids.agencyB)).toBe(false);
    expect(state.get(fixture.ids.agencyA)).toBe(false);
  });
});
