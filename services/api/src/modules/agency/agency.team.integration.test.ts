import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
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

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_invitations,
  agency_members,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";

const { app } = await import("../../app.js");

const PREFIX = "agency-it-";
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

const agencyBody = () => ({
  role: "freelancer",
  name: `${PREFIX}agency`,
  size: "1-10",
  specialty: "testing",
  overview: "integration test agency",
});

const createAgencyAs = (userId: string) =>
  request(app).post(API).set(as(userId)).send(agencyBody());

const newOwner = async () => {
  const ownerId = await insertAccount(newAuthId());
  const response = await createAgencyAs(ownerId);
  expect(response.status).toBe(201);
  return { ownerId, agencyId: response.body.data.id as string };
};

const invite = (ownerId: string, email: string) =>
  request(app)
    .post(`${API}/team/invitations`)
    .set(as(ownerId))
    .send({ role: "freelancer", email });

const invitationIdFor = async (agencyId: string, email: string) => {
  const [row] = await db
    .select({ id: agency_invitations.id })
    .from(agency_invitations)
    .where(
      sql`${agency_invitations.agency_id} = ${agencyId} and ${agency_invitations.email} = ${email}`,
    );
  return row!.id;
};

const respond = (userId: string, invitationId: string, accept: boolean) =>
  request(app)
    .patch(`${API}/invitations/${invitationId}/respond`)
    .set(as(userId))
    .send({ role: "freelancer", accept });

const membershipCount = async (freelancerId: string) => {
  const rows = await db
    .select({ id: agency_members.id })
    .from(agency_members)
    .where(eq(agency_members.freelancer_id, freelancerId));
  return rows.length;
};

const invitationStatus = async (id: string) => {
  const [row] = await db
    .select({ status: agency_invitations.status })
    .from(agency_invitations)
    .where(eq(agency_invitations.id, id));
  return row?.status;
};

const purge = async () => {
  const like = `${PREFIX}%`;
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
  mocks.store.clear();
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({ firstName: "Test", lastName: "User" });
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
});

describe("single agency per freelancer", () => {
  it("rejects a second agency from the owner with a coded 409", async () => {
    const { ownerId } = await newOwner();

    const response = await createAgencyAs(ownerId);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await membershipCount(ownerId)).toBe(1);
  });

  it("rejects an agency from a member of another agency", async () => {
    const { ownerId, agencyId } = await newOwner();
    const memberId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(memberId));
    const invitationId = await invitationIdFor(agencyId, emailOf(memberId));
    expect((await respond(memberId, invitationId, true)).status).toBe(200);

    const response = await createAgencyAs(memberId);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await membershipCount(memberId)).toBe(1);
  });

  it("lets exactly one of two parallel creations win and rolls the loser back", async () => {
    const userId = await insertAccount(newAuthId());

    const results = await Promise.all([
      createAgencyAs(userId),
      createAgencyAs(userId),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const loser = results.find((result) => result.status === 409)!;
    expect(loser.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await membershipCount(userId)).toBe(1);
    const agencies = await pool.query(
      "select id from agency_metadata where owner_id = $1",
      [userId],
    );
    expect(agencies.rowCount).toBe(1);
  });

  it("answers a coded 409 when a membership commits between the pre-checks and the insert", async () => {
    const { agencyId } = await newOwner();
    const userId = await insertAccount(newAuthId());
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("begin");
      await holder.query(
        "insert into agency_members (agency_id, freelancer_id, role) values ($1, $2, 'Member')",
        [agencyId, userId],
      );
      pending = createAgencyAs(userId).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("commit");
    } catch (error) {
      await holder.query("rollback");
      throw error;
    } finally {
      holder.release();
    }

    const response = await pending!;

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await membershipCount(userId)).toBe(1);
    const agencies = await pool.query(
      "select id from agency_metadata where owner_id = $1",
      [userId],
    );
    expect(agencies.rowCount).toBe(0);
  });

  it("answers a coded 409 when the owner's agency commits between the pre-checks and the insert", async () => {
    const userId = await insertAccount(newAuthId());
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("begin");
      const inserted = await holder.query(
        "insert into agency_metadata (owner_id, name, size, specialty, overview) values ($1, $2, '1-10', 'testing', 'held') returning id",
        [userId, `${PREFIX}held`],
      );
      await holder.query(
        "insert into agency_members (agency_id, freelancer_id, role) values ($1, $2, 'Owner')",
        [inserted.rows[0].id, userId],
      );
      pending = createAgencyAs(userId).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("commit");
    } catch (error) {
      await holder.query("rollback");
      throw error;
    } finally {
      holder.release();
    }

    const response = await pending!;

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await membershipCount(userId)).toBe(1);
    const agencies = await pool.query(
      "select id from agency_metadata where owner_id = $1",
      [userId],
    );
    expect(agencies.rowCount).toBe(1);
  });

  it("answers 403 when the caller has no freelancer account", async () => {
    const response = await createAgencyAs(newAuthId());

    expect(response.status).toBe(403);
  });
});

describe("guarded invitation response", () => {
  it.each([
    [
      "accepted",
      async (_o: string, _i: string, m: string, id: string) =>
        respond(m, id, true),
    ],
    [
      "declined",
      async (_o: string, _i: string, m: string, id: string) =>
        respond(m, id, false),
    ],
    [
      "cancelled",
      async (o: string, _i: string, _m: string, id: string) =>
        request(app)
          .delete(`${API}/team/invitations/${id}`)
          .set(as(o))
          .query({ role: "freelancer" }),
    ],
  ])("answers 409 for an invitation already %s", async (_name, first) => {
    const { ownerId, agencyId } = await newOwner();
    const memberId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(memberId));
    const invitationId = await invitationIdFor(agencyId, emailOf(memberId));
    expect(
      (await first(ownerId, agencyId, memberId, invitationId)).status,
    ).toBe(200);
    const membersBefore = await membershipCount(memberId);

    const response = await respond(memberId, invitationId, true);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INVITATION_ALREADY_HANDLED");
    expect(await membershipCount(memberId)).toBe(membersBefore);
  });

  it("rolls the status back when the caller is already in another agency", async () => {
    const first = await newOwner();
    const second = await newOwner();
    const memberId = await insertAccount(newAuthId());
    await invite(first.ownerId, emailOf(memberId));
    await invite(second.ownerId, emailOf(memberId));
    const firstInvite = await invitationIdFor(
      first.agencyId,
      emailOf(memberId),
    );
    const secondInvite = await invitationIdFor(
      second.agencyId,
      emailOf(memberId),
    );
    expect((await respond(memberId, firstInvite, true)).status).toBe(200);

    const response = await respond(memberId, secondInvite, true);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ALREADY_IN_AGENCY");
    expect(await invitationStatus(secondInvite)).toBe("PENDING");
    expect(await membershipCount(memberId)).toBe(1);
  });

  it("lets exactly one of two parallel accepts win", async () => {
    const first = await newOwner();
    const second = await newOwner();
    const memberId = await insertAccount(newAuthId());
    await invite(first.ownerId, emailOf(memberId));
    await invite(second.ownerId, emailOf(memberId));
    const firstInvite = await invitationIdFor(
      first.agencyId,
      emailOf(memberId),
    );
    const secondInvite = await invitationIdFor(
      second.agencyId,
      emailOf(memberId),
    );

    const results = await Promise.all([
      respond(memberId, firstInvite, true),
      respond(memberId, secondInvite, true),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await membershipCount(memberId)).toBe(1);
    const statuses = [
      await invitationStatus(firstInvite),
      await invitationStatus(secondInvite),
    ].sort();
    expect(statuses).toEqual(["ACCEPTED", "PENDING"]);
  });
});

describe("invitation privacy", () => {
  it("answers identically for unknown, registered, other-agency and pending-elsewhere emails", async () => {
    const owner = await newOwner();
    const other = await newOwner();

    const unknownEmail = emailOf(newAuthId());
    const registered = await insertAccount(newAuthId());
    const otherMember = await insertAccount(newAuthId());
    const pendingElsewhere = emailOf(newAuthId());

    await invite(other.ownerId, emailOf(otherMember));
    const joinInvite = await invitationIdFor(
      other.agencyId,
      emailOf(otherMember),
    );
    expect((await respond(otherMember, joinInvite, true)).status).toBe(200);
    await invite(other.ownerId, pendingElsewhere);

    const responses = [];
    for (const email of [
      unknownEmail,
      emailOf(registered),
      emailOf(otherMember),
      pendingElsewhere,
    ]) {
      responses.push(await invite(owner.ownerId, email));
    }

    for (const response of responses) {
      expect(response.status).toBe(201);
      expect(Object.keys(response.body).sort()).toEqual(
        Object.keys(responses[0]!.body).sort(),
      );
      expect(Object.keys(response.body.data).sort()).toEqual(
        Object.keys(responses[0]!.body.data).sort(),
      );
      expect(response.body.data).not.toHaveProperty("notifiedInApp");
      expect(response.body.message).toBe(responses[0]!.body.message);
    }
    expect(await membershipCount(otherMember)).toBe(1);
  });

  it("lists pending invitations with null avatarUrl and identical keys for every email kind", async () => {
    mocks.getUser.mockResolvedValue({
      firstName: "Test",
      lastName: "User",
      imageUrl: "https://img.example.test/leak.png",
    });
    const owner = await newOwner();
    const other = await newOwner();
    const registered = await insertAccount(newAuthId());
    const otherMember = await insertAccount(newAuthId());
    await invite(other.ownerId, emailOf(otherMember));
    const joinInvite = await invitationIdFor(
      other.agencyId,
      emailOf(otherMember),
    );
    expect((await respond(otherMember, joinInvite, true)).status).toBe(200);

    const emails = [
      emailOf(newAuthId()),
      emailOf(registered),
      emailOf(otherMember),
    ];
    for (const email of emails) {
      expect((await invite(owner.ownerId, email)).status).toBe(201);
    }

    const response = await request(app)
      .get(`${API}/team/invitations`)
      .query({ role: "freelancer" })
      .set(as(owner.ownerId));

    expect(response.status).toBe(200);
    const rows = response.body.data as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.email).sort()).toEqual([...emails].sort());
    for (const row of rows) {
      expect(row.avatarUrl).toBeNull();
      expect(Object.keys(row).sort()).toEqual(Object.keys(rows[0]!).sort());
    }
  });

  it("answers a specific 409 for a member of the same agency", async () => {
    const { ownerId, agencyId } = await newOwner();
    const memberId = await insertAccount(newAuthId());
    await invite(ownerId, emailOf(memberId));
    const invitationId = await invitationIdFor(agencyId, emailOf(memberId));
    await respond(memberId, invitationId, true);

    const response = await invite(ownerId, emailOf(memberId));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INVITEE_ALREADY_MEMBER");
  });

  it("answers a specific 409 for a pending invitation in the same agency", async () => {
    const { ownerId } = await newOwner();
    const email = emailOf(newAuthId());
    expect((await invite(ownerId, email)).status).toBe(201);

    const response = await invite(ownerId, email);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("INVITATION_ALREADY_PENDING");
  });
});

describe("resend cooldown", () => {
  const resend = (ownerId: string, invitationId: string) =>
    request(app)
      .post(`${API}/team/invitations/${invitationId}/resend`)
      .set(as(ownerId))
      .query({ role: "freelancer" });

  it("answers 429 within 60 seconds and 200 after the cooldown", async () => {
    const { ownerId, agencyId } = await newOwner();
    const email = emailOf(newAuthId());
    await invite(ownerId, email);
    const invitationId = await invitationIdFor(agencyId, email);

    const tooSoon = await resend(ownerId, invitationId);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe("INVITATION_RESEND_COOLDOWN");

    await db
      .update(agency_invitations)
      .set({ updated_at: sql`now() - interval '61 seconds'` })
      .where(eq(agency_invitations.id, invitationId));

    const allowed = await resend(ownerId, invitationId);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toBeNull();

    const again = await resend(ownerId, invitationId);
    expect(again.status).toBe(429);
  });

  it("answers 404 for an unknown or non-pending invitation", async () => {
    const { ownerId, agencyId } = await newOwner();
    const email = emailOf(newAuthId());
    await invite(ownerId, email);
    const invitationId = await invitationIdFor(agencyId, email);
    await request(app)
      .delete(`${API}/team/invitations/${invitationId}`)
      .set(as(ownerId))
      .query({ role: "freelancer" });

    expect((await resend(ownerId, randomUUID())).status).toBe(404);
    expect((await resend(ownerId, invitationId)).status).toBe(404);
  });
});
