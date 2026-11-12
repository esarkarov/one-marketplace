import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  emitConversationUpdate: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
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

vi.mock("./messaging.socket.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./messaging.socket.js")>()),
  emitConversationUpdate: mocks.emitConversationUpdate,
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  client_metadata,
  conversation_participants,
  conversations,
  message_attachments,
  messages,
  freelancer_metadata,
  job_posts,
  meetings,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { messagingResponses } from "./messaging.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "messaging-contract-it-";
const API = "/api/v1/conversations";

const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
  if (role === "FREELANCER") {
    await db.insert(freelancer_metadata).values({
      auth_id: authId,
      professional_title: "Backend developer",
      professional_description: "Messaging test freelancer",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30+ hours",
      experience_level: "INTERMEDIATE",
      skills: ["TypeScript"],
      languages: [{ language: "English", proficiency: "Fluent" }],
    });
  } else {
    await db.insert(client_metadata).values({
      auth_id: authId,
      role: "CLIENT",
      company_name: "Acme Inc",
      company_website: "https://acme.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "Messaging test client",
    });
  }
  return authId;
};

const seed = async () => {
  const clientId = await insertAccount("CLIENT");
  const freelancerId = await insertAccount("FREELANCER");
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Messaging job",
      description: "Messaging test job",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 20000,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: job!.id,
      sender_id: freelancerId,
      sender_type: "FREELANCER",
      cover_letter: "messaging test",
      bid_amount_cents: 20000,
      duration: "1 week",
    })
    .returning({ id: proposals.id });
  const [conversation] = await db
    .insert(conversations)
    .values({
      job_id: job!.id,
      proposal_id: proposal!.id,
      context_key: `${PREFIX}${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  await db.insert(conversation_participants).values([
    {
      conversation_id: conversation!.id,
      account_id: clientId,
      participant_type: "CLIENT",
    },
    {
      conversation_id: conversation!.id,
      account_id: freelancerId,
      participant_type: "FREELANCER",
    },
  ]);
  return {
    clientId,
    freelancerId,
    jobId: job!.id,
    proposalId: proposal!.id,
    conversationId: conversation!.id,
  };
};

type Fixture = Awaited<ReturnType<typeof seed>>;

const seedMessages = async (fixture: Fixture) => {
  const base = Date.now() - 60_000;
  const [first] = await db
    .insert(messages)
    .values({
      conversation_id: fixture.conversationId,
      sender_id: fixture.clientId,
      body: "Hello there",
      created_at: new Date(base),
    })
    .returning({ id: messages.id });
  await db.insert(message_attachments).values({
    message_id: first!.id,
    storage_key: `file_${randomUUID()}`,
    file_url: "https://example.test/brief.pdf",
    file_name: "brief.pdf",
    mime_type: "application/pdf",
    file_size: 2048,
    attachment_type: "FILE",
  });
  const [second] = await db
    .insert(messages)
    .values({
      conversation_id: fixture.conversationId,
      sender_id: fixture.freelancerId,
      body: "Hi, happy to help",
      reply_to_message_id: first!.id,
      created_at: new Date(base + 1000),
    })
    .returning({ id: messages.id });
  const [event] = await db
    .insert(messages)
    .values({
      conversation_id: fixture.conversationId,
      sender_id: fixture.clientId,
      message_type: "SYSTEM_EVENT",
      event_type: "CONTRACT_OFFER",
      event_payload: { contractId: randomUUID(), amountCents: 20000 },
      created_at: new Date(base + 2000),
    })
    .returning({ id: messages.id, createdAt: messages.created_at });
  await db
    .update(conversations)
    .set({ last_message_id: event!.id, last_message_at: event!.createdAt })
    .where(eq(conversations.id, fixture.conversationId));
  return { firstId: first!.id, secondId: second!.id, eventId: event!.id };
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    like,
  ]);
  await pool.query(
    "delete from conversations where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
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
  mocks.emitConversationUpdate.mockReset();
  mocks.emitConversationUpdate.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({
    firstName: "Test",
    lastName: "User",
    imageUrl: "https://example.test/avatar.png",
  });
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
});

describe("GET /conversations", () => {
  it("matches the 200 schema with messages and an active meeting", async () => {
    const fixture = await seed();
    await seedMessages(fixture);
    await db.insert(meetings).values({
      conversation_id: fixture.conversationId,
      provider_room_name: `room-${randomUUID()}`,
      join_url: "https://daily.test/room",
      started_by_account_id: fixture.clientId,
    });
    const response = await request(app)
      .get(API)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(200);
    const body = messagingResponses.list[200].parse(response.body);
    expect(body.data.conversations).toHaveLength(1);
    expect(body.data.conversations[0]?.activeMeeting).not.toBeNull();
    expect(body.data.conversations[0]?.lastMessage).not.toBeNull();
  });

  it("matches the 200 schema for a conversation without messages", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(API)
      .query({ role: "freelancer" })
      .set(as(fixture.freelancerId));
    expect(response.status).toBe(200);
    const body = messagingResponses.list[200].parse(response.body);
    expect(body.data.conversations[0]?.lastMessage).toBeNull();
  });

  it("matches the 200 schema for an empty agency scope", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(API)
      .query({ role: "freelancer", scope: "agency" })
      .set(as(fixture.freelancerId));
    expect(response.status).toBe(200);
    messagingResponses.list[200].parse(response.body);
  });
});

describe("POST /conversations", () => {
  it("matches the 201 schema for a direct conversation", async () => {
    const clientId = await insertAccount("CLIENT");
    const freelancerId = await insertAccount("FREELANCER");
    const response = await request(app)
      .post(API)
      .query({ role: "client" })
      .set(as(clientId))
      .send({ recipientId: freelancerId });
    expect(response.status).toBe(201);
    messagingResponses.open[201].parse(response.body);
  });

  it("matches the 201 schema for a proposal conversation", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(API)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({ proposalId: fixture.proposalId });
    expect(response.status).toBe(201);
    messagingResponses.open[201].parse(response.body);
  });

  it("matches the 403 schema for a freelancer account", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(API)
      .query({ role: "freelancer" })
      .set(as(fixture.freelancerId))
      .send({ recipientId: fixture.clientId });
    expect(response.status).toBe(403);
    messagingResponses.open[403].parse(response.body);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(API)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({ proposalId: randomUUID() });
    expect(response.status).toBe(404);
    messagingResponses.open[404].parse(response.body);
  });
});

describe("POST /conversations/:conversationId/messages", () => {
  it("matches the 201 schema", async () => {
    const fixture = await seed();
    const { firstId } = await seedMessages(fixture);
    const response = await request(app)
      .post(`${API}/${fixture.conversationId}/messages`)
      .query({ role: "freelancer" })
      .set(as(fixture.freelancerId))
      .send({ body: "A reply", replyToMessageId: firstId });
    expect(response.status).toBe(201);
    const body = messagingResponses.send[201].parse(response.body);
    expect(body.data.replyTo).not.toBeNull();
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(`${API}/${randomUUID()}/messages`)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({ body: "Hello" });
    expect(response.status).toBe(404);
    messagingResponses.send[404].parse(response.body);
  });
});

describe("GET /conversations/:conversationId/messages", () => {
  it("matches the 200 schema with attachments, replies and a cursor", async () => {
    const fixture = await seed();
    await seedMessages(fixture);
    const first = await request(app)
      .get(`${API}/${fixture.conversationId}/messages`)
      .query({ role: "client", limit: "2" })
      .set(as(fixture.clientId));
    expect(first.status).toBe(200);
    const page = messagingResponses.messages[200].parse(first.body);
    expect(page.data.messages).toHaveLength(2);
    expect(page.data.nextCursor).not.toBeNull();

    const second = await request(app)
      .get(`${API}/${fixture.conversationId}/messages`)
      .query({ role: "client", limit: "2", cursor: page.data.nextCursor })
      .set(as(fixture.clientId));
    expect(second.status).toBe(200);
    const rest = messagingResponses.messages[200].parse(second.body);
    const restMessages = rest.data.messages as { attachments: unknown[] }[];
    expect(restMessages).toHaveLength(1);
    expect(restMessages[0]?.attachments).toHaveLength(1);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .get(`${API}/${randomUUID()}/messages`)
      .query({ role: "client" })
      .set(as(fixture.clientId));
    expect(response.status).toBe(404);
    messagingResponses.messages[404].parse(response.body);
  });
});

describe("POST /conversations/:conversationId/read", () => {
  it("matches the 200 schema", async () => {
    const fixture = await seed();
    const { eventId } = await seedMessages(fixture);
    const response = await request(app)
      .post(`${API}/${fixture.conversationId}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.freelancerId))
      .send({ lastReadMessageId: eventId });
    expect(response.status).toBe(200);
    messagingResponses.read[200].parse(response.body);

    const again = await request(app)
      .post(`${API}/${fixture.conversationId}/read`)
      .query({ role: "freelancer" })
      .set(as(fixture.freelancerId))
      .send({ lastReadMessageId: eventId });
    expect(again.status).toBe(200);
    messagingResponses.read[200].parse(again.body);
  });

  it("matches the 404 schema", async () => {
    const fixture = await seed();
    const response = await request(app)
      .post(`${API}/${randomUUID()}/read`)
      .query({ role: "client" })
      .set(as(fixture.clientId))
      .send({ lastReadMessageId: randomUUID() });
    expect(response.status).toBe(404);
    messagingResponses.read[404].parse(response.body);
  });
});
