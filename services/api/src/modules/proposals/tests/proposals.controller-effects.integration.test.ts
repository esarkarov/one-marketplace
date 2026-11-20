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
  verifyToken: vi.fn(),
  getUser: vi.fn(),
  sendNotification: vi.fn(),
  pushNotice: vi.fn(),
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

vi.mock(
  "@/infrastructure/events/notification.publisher.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/infrastructure/events/notification.publisher.js")
    >()),
    sendNotification: mocks.sendNotification,
  }),
);

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
    pushStoredNotification: async (row: {
      event_id: string;
      recipient_id: string | null;
      agency_id: string | null;
      type: string;
      title: string;
      message: string;
      link: string | null;
      metadata: unknown;
    }) => {
      try {
        await mocks.pushNotice({
          ...(row.agency_id
            ? { agencyId: row.agency_id }
            : { recipientId: row.recipient_id }),
          type: row.type,
          title: row.title,
          message: row.message,
          link: row.link,
          metadata: row.metadata,
          eventId: row.event_id,
        });
      } catch {}
    },
  };
});

vi.mock("@/modules/messaging/messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/messaging/messaging.socket.js")
  >()),
  emitConversationUpdate: vi.fn(),
}));

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

import { db, pool } from "@/database/client.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import {
  accounts,
  agency_members,
  agency_metadata,
  client_metadata,
  connects,
  freelancer_metadata,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";

const { app } = await import("@/app.js");

const PREFIX = "proposals-effects-";
const API = "/api/v1/proposals";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

const insertAccount = async (authId: string, role: "CLIENT" | "FREELANCER") => {
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

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    `%${PREFIX}%`,
  ]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const seed = async (senderType: "FREELANCER" | "AGENCY") => {
  const clientId = await insertAccount(newAuthId(), "CLIENT");
  await db.insert(client_metadata).values({
    auth_id: clientId,
    role: "Founder",
    company_name: "Acme",
    company_website: "https://acme.example.test",
    company_size: "11-50",
    industry: "Software",
    company_description: "We build things.",
    created_at: new Date(),
    updated_at: new Date(),
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Effects job",
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

  const freelancerId = await insertAccount(newAuthId(), "FREELANCER");
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

  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: agencyId ?? freelancerId,
      sender_type: senderType,
      cover_letter: "pitch",
      bid_amount_cents: 50000,
      duration: "1 week",
      screening_answers: [],
    })
    .returning({ id: proposals.id });

  return { clientId, freelancerId, agencyId, proposalId: proposal!.id };
};

const statusOf = async (proposalId: string) =>
  (await pool.query("select status from proposals where id = $1", [proposalId]))
    .rows[0].status as string;

const conversationOf = async (proposalId: string) =>
  (
    await pool.query("select id from conversations where proposal_id = $1", [
      proposalId,
    ])
  ).rows[0]?.id as string | undefined;

const markViewed = (proposalId: string, clientId: string) =>
  request(app)
    .patch(`${API}/${proposalId}/status`)
    .set(as(clientId))
    .send({ role: "client" });

const interview = (proposalId: string, clientId: string) =>
  request(app)
    .post(`${API}/${proposalId}/interview`)
    .set(as(clientId))
    .send({ role: "client", message: "Let us talk." });

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  mocks.failAfterInsert = false;
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue(undefined);
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
});

describe("proposal viewed notification", () => {
  it("notifies a freelancer sender once, after the status is committed", async () => {
    const fixture = await seed("FREELANCER");
    const statusAtCall: string[] = [];
    mocks.sendNotification.mockImplementation(async () => {
      statusAtCall.push(await statusOf(fixture.proposalId));
    });

    const response = await markViewed(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Proposal marked as viewed.");
    expect(response.body.data.status).toBe("VIEWED");
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      recipientId: fixture.freelancerId,
      type: "PROPOSAL_VIEWED",
      title: "Your proposal was viewed",
      message: "A client viewed your proposal for “Effects job”.",
      link: "/my-proposals",
      metadata: { proposalId: fixture.proposalId },
    });
    expect(statusAtCall).toEqual(["VIEWED"]);
  });

  it("does not notify again when the proposal was already viewed", async () => {
    const fixture = await seed("FREELANCER");
    await markViewed(fixture.proposalId, fixture.clientId);
    mocks.sendNotification.mockClear();

    const again = await markViewed(fixture.proposalId, fixture.clientId);

    expect(again.status).toBe(200);
    expect(again.body.message).toBe("Proposal marked as viewed.");
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("notifies the agency for an agency sender", async () => {
    const fixture = await seed("AGENCY");

    const response = await markViewed(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(200);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotification).toHaveBeenCalledWith({
      agencyId: fixture.agencyId,
      type: "PROPOSAL_VIEWED",
      title: "Your proposal was viewed",
      message: "A client viewed your proposal for “Effects job”.",
      link: "/proposals",
      metadata: { proposalId: fixture.proposalId },
    });
  });

  it("propagates a rejected notification as a 500 and keeps the committed status", async () => {
    const fixture = await seed("FREELANCER");
    mocks.sendNotification.mockRejectedValue(new Error("broker down"));

    const response = await markViewed(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(500);
    expect(await statusOf(fixture.proposalId)).toBe("VIEWED");
  });

  it("sends no notification when shortlisting", async () => {
    const fixture = await seed("FREELANCER");

    const response = await request(app)
      .patch(`${API}/${fixture.proposalId}/status`)
      .set(as(fixture.clientId))
      .send({ role: "client", isShortlisted: true });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Proposal shortlisted.");
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

const interviewEventId = (proposalId: string) =>
  notificationEventId("PROPOSAL_INTERVIEWED", proposalId, "interviewed");

const storedInterviewNotices = async (proposalId: string) =>
  (
    await pool.query("select * from notifications where event_id = $1", [
      interviewEventId(proposalId),
    ])
  ).rows;

describe("proposal interview notification", () => {
  it("notifies a freelancer sender once, after the conversation is committed", async () => {
    const fixture = await seed("FREELANCER");
    const conversationAtCall: Array<string | undefined> = [];
    mocks.pushNotice.mockImplementation(async () => {
      conversationAtCall.push(await conversationOf(fixture.proposalId));
    });

    const response = await interview(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Interview started.");
    const conversationId = await conversationOf(fixture.proposalId);
    expect(conversationId).toBeDefined();
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      recipientId: fixture.freelancerId,
      eventId: interviewEventId(fixture.proposalId),
      type: "PROPOSAL_INTERVIEWED",
      title: "You received an interview",
      message: "A client started an interview for “Effects job”.",
      link: `/messages?conversationId=${conversationId}`,
      metadata: { proposalId: fixture.proposalId, conversationId },
    });
    expect(conversationAtCall).toEqual([conversationId]);
  });

  it("notifies the agency for an agency sender", async () => {
    const fixture = await seed("AGENCY");

    const response = await interview(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(201);
    const conversationId = await conversationOf(fixture.proposalId);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      agencyId: fixture.agencyId,
      eventId: interviewEventId(fixture.proposalId),
      type: "PROPOSAL_INTERVIEWED",
      title: "You received an interview",
      message: "A client started an interview for “Effects job”.",
      link: `/messages?conversationId=${conversationId}`,
      metadata: { proposalId: fixture.proposalId, conversationId },
    });
  });

  it("does not fail the request when the push fails and keeps the stored notice", async () => {
    const fixture = await seed("FREELANCER");
    mocks.pushNotice.mockRejectedValue(new Error("sse down"));

    const response = await interview(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(201);
    expect(await conversationOf(fixture.proposalId)).toBeDefined();
    expect(await storedInterviewNotices(fixture.proposalId)).toHaveLength(1);
  });

  it("stores the exact row for a freelancer sender with the broker untouched", async () => {
    const fixture = await seed("FREELANCER");

    await interview(fixture.proposalId, fixture.clientId);

    const conversationId = await conversationOf(fixture.proposalId);
    const [row] = await storedInterviewNotices(fixture.proposalId);
    expect(row).toMatchObject({
      recipient_id: fixture.freelancerId,
      agency_id: null,
      type: "PROPOSAL_INTERVIEWED",
      title: "You received an interview",
      message: "A client started an interview for “Effects job”.",
      link: `/messages?conversationId=${conversationId}`,
      metadata: { proposalId: fixture.proposalId, conversationId },
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("stores the agency row for an agency sender", async () => {
    const fixture = await seed("AGENCY");

    await interview(fixture.proposalId, fixture.clientId);

    const [row] = await storedInterviewNotices(fixture.proposalId);
    expect(row).toMatchObject({
      recipient_id: null,
      agency_id: fixture.agencyId,
    });
  });

  it("leaves no notice and no state change when the transaction fails after the insert", async () => {
    const fixture = await seed("FREELANCER");
    mocks.failAfterInsert = true;

    const response = await interview(fixture.proposalId, fixture.clientId);

    expect(response.status).toBe(500);
    expect(await conversationOf(fixture.proposalId)).toBeUndefined();
    expect(await storedInterviewNotices(fixture.proposalId)).toEqual([]);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });

  it("creates one row and one push when two interview requests race", async () => {
    const fixture = await seed("FREELANCER");

    const responses = await Promise.all([
      interview(fixture.proposalId, fixture.clientId),
      interview(fixture.proposalId, fixture.clientId),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(await storedInterviewNotices(fixture.proposalId)).toHaveLength(1);
    expect(mocks.pushNotice).toHaveBeenCalledTimes(1);
  });

  it("answers 409 on a second interview without a second notification", async () => {
    const fixture = await seed("FREELANCER");
    await interview(fixture.proposalId, fixture.clientId);
    mocks.pushNotice.mockClear();

    const again = await interview(fixture.proposalId, fixture.clientId);

    expect(again.status).toBe(409);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });

  it("answers 403 for a freelancer without notifying", async () => {
    const fixture = await seed("FREELANCER");

    const response = await request(app)
      .post(`${API}/${fixture.proposalId}/interview`)
      .set(as(fixture.freelancerId))
      .send({ role: "freelancer", message: "Hi" });

    expect(response.status).toBe(403);
    expect(mocks.pushNotice).not.toHaveBeenCalled();
  });
});
