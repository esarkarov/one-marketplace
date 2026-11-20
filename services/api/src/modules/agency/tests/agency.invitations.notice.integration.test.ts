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
  getUser: vi.fn(),
  sendNotification: vi.fn(),
  push: vi.fn(),
  visibleAtPush: [] as number[],
  pushThrows: false,
  failAfterInsert: false,
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("@/infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
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

vi.mock(
  "@/infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

import { db, pool } from "@/database/client.js";
import { accounts } from "@/test/support/tables.js";

vi.mock("@/modules/notification-store/index.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/notification-store/index.js")
    >();
  return {
    ...original,
    insertNotification: async (
      ...args: Parameters<typeof original.insertNotification>
    ) => {
      const row = await original.insertNotification(...args);
      if (mocks.failAfterInsert) throw new Error("injected failure");
      return row;
    },
    pushStoredNotification: async (row: { event_id: string }) => {
      const visible = await pool.query(
        "select count(*)::int as c from notifications where event_id = $1",
        [row.event_id],
      );
      mocks.visibleAtPush.push(visible.rows[0].c);
      mocks.push(row);
      if (mocks.pushThrows) throw new Error("sse down");
    },
  };
});

import { notificationEventId } from "@/modules/notification-store/index.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";

const { app } = await import("@/app.js");

const PREFIX = "agency-notice-it-";
const API = "/api/v1/agency";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const emailOf = (authId: string) => `${authId}@example.test`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const insertAccount = async (
  authId: string,
  role: "CLIENT" | "FREELANCER" = "FREELANCER",
) => {
  await db.insert(accounts).values({
    auth_id: authId,
    email: emailOf(authId),
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const newOwner = async () => {
  const ownerId = await insertAccount(newAuthId());
  const response = await request(app)
    .post(API)
    .set(as(ownerId))
    .send({
      role: "freelancer",
      name: `${PREFIX}agency`,
      size: "1-10",
      specialty: "testing",
      overview: "integration test agency",
    });
  expect(response.status).toBe(201);
  return { ownerId, agencyId: response.body.data.id as string };
};

const invite = (ownerId: string, email: string) =>
  request(app)
    .post(`${API}/team/invitations`)
    .set(as(ownerId))
    .send({ role: "freelancer", email });

const resend = (ownerId: string, invitationId: string) =>
  request(app)
    .post(`${API}/team/invitations/${invitationId}/resend`)
    .set(as(ownerId))
    .send({ role: "freelancer" });

const rowsOf = async (text: string, params: unknown[]) =>
  (await pool.query(text, params)).rows;

const invitationRows = (agencyId: string, email: string) =>
  rowsOf(
    "select id, updated_at from agency_invitations where agency_id = $1 and email = $2",
    [agencyId, email],
  );

const noticesFor = (invitationId: string) =>
  rowsOf(
    "select * from notifications where type = 'AGENCY_INVITATION' and metadata->>'agencyId' is not null and event_id in ($1, $2)",
    [
      notificationEventId("AGENCY_INVITATION", invitationId, "invited"),
      "00000000-0000-0000-0000-000000000000",
    ],
  );

const resentNotices = async (invitationId: string, updatedAt: Date) =>
  rowsOf("select * from notifications where event_id = $1", [
    notificationEventId(
      "AGENCY_INVITATION",
      invitationId,
      `resent-${updatedAt.getTime()}`,
    ),
  ]);

const allNoticesFor = (recipient: string) =>
  rowsOf(
    "select * from notifications where recipient_id = $1 and type = 'AGENCY_INVITATION'",
    [recipient],
  );

const expireCooldown = (invitationId: string) =>
  pool.query(
    "update agency_invitations set updated_at = now() - interval '2 minutes' where id = $1",
    [invitationId],
  );

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from notifications where recipient_id like $1", [
    like,
  ]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
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
  vi.clearAllMocks();
  mocks.visibleAtPush.length = 0;
  mocks.pushThrows = false;
  mocks.failAfterInsert = false;
  mocks.store.clear();
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({ firstName: "Test", lastName: "User" });
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
});

describe("AGENCY_INVITATION in the invitation transaction", () => {
  it("stores the exact row with the invited event id, visible at push time, pushed once, no broker publish", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());

    const response = await invite(ownerId, emailOf(inviteeId));

    expect(response.status).toBe(201);
    const [invitation] = await invitationRows(agencyId, emailOf(inviteeId));
    const [row] = await noticesFor(invitation.id);
    expect(row).toMatchObject({
      event_id: notificationEventId(
        "AGENCY_INVITATION",
        invitation.id,
        "invited",
      ),
      recipient_id: inviteeId,
      agency_id: null,
      type: "AGENCY_INVITATION",
      title: "You've been invited to join an agency",
      message: `${PREFIX}agency invited you to join their agency team.`,
      link: "/agency-invitations",
      metadata: { agencyId },
    });
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.visibleAtPush).toEqual([1]);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("writes no notice for an unknown address, a client account or a member of an agency", async () => {
    const { ownerId } = await newOwner();
    const clientId = await insertAccount(newAuthId(), "CLIENT");
    const { ownerId: otherOwner } = await newOwner();

    expect((await invite(ownerId, `${PREFIX}nobody@example.test`)).status).toBe(
      201,
    );
    expect((await invite(ownerId, emailOf(clientId))).status).toBe(201);
    expect((await invite(ownerId, emailOf(otherOwner))).status).toBe(201);

    expect(await allNoticesFor(clientId)).toEqual([]);
    expect(await allNoticesFor(otherOwner)).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("creates no invitation and no notice when the transaction fails after the insert", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());
    mocks.failAfterInsert = true;

    const response = await invite(ownerId, emailOf(inviteeId));

    expect(response.status).toBe(500);
    expect(await invitationRows(agencyId, emailOf(inviteeId))).toEqual([]);
    expect(await allNoticesFor(inviteeId)).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not fail the request when the push fails", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());
    mocks.pushThrows = true;

    const response = await invite(ownerId, emailOf(inviteeId));

    expect(response.status).toBe(201);
    expect(await invitationRows(agencyId, emailOf(inviteeId))).toHaveLength(1);
    expect(await allNoticesFor(inviteeId)).toHaveLength(1);
  });

  it("keeps one row and one push when the same invitation is requested twice", async () => {
    const { ownerId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());

    expect((await invite(ownerId, emailOf(inviteeId))).status).toBe(201);
    expect((await invite(ownerId, emailOf(inviteeId))).status).toBe(409);

    expect(await allNoticesFor(inviteeId)).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});

describe("AGENCY_INVITATION on resend", () => {
  it("stores a new row per resend keyed by the touch timestamp, and none inside the cooldown", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(inviteeId));
    const [invitation] = await invitationRows(agencyId, emailOf(inviteeId));
    mocks.push.mockClear();

    expect((await resend(ownerId, invitation.id)).status).toBe(429);
    expect(await allNoticesFor(inviteeId)).toHaveLength(1);

    await expireCooldown(invitation.id);
    expect((await resend(ownerId, invitation.id)).status).toBe(200);
    const [touched] = await invitationRows(agencyId, emailOf(inviteeId));
    expect(
      await resentNotices(invitation.id, touched.updated_at as Date),
    ).toHaveLength(1);
    expect(await allNoticesFor(inviteeId)).toHaveLength(2);
    expect(mocks.push).toHaveBeenCalledTimes(1);

    await expireCooldown(invitation.id);
    expect((await resend(ownerId, invitation.id)).status).toBe(200);
    expect(await allNoticesFor(inviteeId)).toHaveLength(3);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("rolls back the resend touch when the transaction fails after the insert", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(inviteeId));
    const [invitation] = await invitationRows(agencyId, emailOf(inviteeId));
    await expireCooldown(invitation.id);
    const [before] = await invitationRows(agencyId, emailOf(inviteeId));
    mocks.failAfterInsert = true;

    const response = await resend(ownerId, invitation.id);

    expect(response.status).toBe(500);
    const [after] = await invitationRows(agencyId, emailOf(inviteeId));
    expect((after.updated_at as Date).getTime()).toBe(
      (before.updated_at as Date).getTime(),
    );
    expect(await allNoticesFor(inviteeId)).toHaveLength(1);
  });

  it("does not fail a resend when the push fails", async () => {
    const { ownerId, agencyId } = await newOwner();
    const inviteeId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(inviteeId));
    const [invitation] = await invitationRows(agencyId, emailOf(inviteeId));
    await expireCooldown(invitation.id);
    mocks.pushThrows = true;

    expect((await resend(ownerId, invitation.id)).status).toBe(200);
    expect(await allNoticesFor(inviteeId)).toHaveLength(2);
  });
});
