import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
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

vi.mock("../../infrastructure/events/publisher.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../infrastructure/events/publisher.js")
    >();
  return { ...original, sendNotification: mocks.sendNotification };
});

vi.mock("../messaging/messaging.socket.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../messaging/messaging.socket.js")>();
  return { ...original, emitConversationUpdate: mocks.emitConversationUpdate };
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
  agency_earning,
  client_spents,
  freelancer_earning,
  agency_members,
  agency_metadata,
  client_metadata,
  connects,
  connects_history,
  conversation_participants,
  conversations,
  freelancer_metadata,
  job_posts,
  messages,
  proposals,
} from "../../test/support/tables.js";
import { PROPOSAL_CONNECTS } from "../../config/constants.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  proposalsCreateResponses,
  proposalsInterviewResponses,
  proposalsListResponses,
  proposalsMetadataResponses,
  proposalsStatusResponses,
} from "./proposals.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "proposals-contract-";
const API = "/api/v1/proposals";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const asClient = { role: "client" };
const asFreelancer = { role: "freelancer" };

const insertAccount = async (
  authId: string,
  role: "CLIENT" | "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
    ...extra,
  });
  return authId;
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from conversations where context_key like $1", [
    `%${PREFIX}%`,
  ]);
  await pool.query("delete from proposals where sender_id like $1", [like]);
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

const createFreelancer = async (ratingScore = "4.50") => {
  const authId = await insertAccount(newAuthId(), "FREELANCER", {
    identityVerified: true,
  });
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
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
  await db.insert(connects).values({ freelancer_id: authId, connects: 100 });
  await db.insert(freelancer_earning).values({
    freelancer_id: authId,
    rating: ratingScore,
    job_success_score: "88.00",
    completed_jobs: 3,
  });
  return authId;
};

const createAgency = async () => {
  const ownerId = await insertAccount(newAuthId(), "FREELANCER");
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: `${PREFIX}agency`,
      size: "1-10",
      specialty: "design",
      overview: "overview",
      tags: ["figma"],
      avatar_image: { imageId: "img", url: "https://example.test/a.png" },
    })
    .returning({ id: agency_metadata.id });
  await db.insert(connects).values({ agency_id: agency!.id, connects: 100 });
  await db.insert(agency_earning).values({
    agency_id: agency!.id,
    rating: "4.90",
    job_success_score: "95.00",
    completed_jobs: 7,
  });
  await db
    .insert(agency_members)
    .values({ agency_id: agency!.id, freelancer_id: ownerId, role: "Founder" });
  return { ownerId, agencyId: agency!.id };
};

const createClientWithJob = async () => {
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
  await db.insert(client_spents).values({ client_id: clientId });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Proposal job",
      description: "desc",
      expertise_level: "EXPERT",
      expected_duration: "1 month",
      skills: ["node"],
      total_budget_cents: 100000,
      milestones: [],
      screening_questions: ["Why you?"],
      status: "PUBLISHED",
      published_at: new Date(),
    })
    .returning({ id: job_posts.id });
  return { clientId, jobId: job!.id };
};

const coverLetter = "I am a strong fit for this job. ".repeat(4);

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
  mocks.sendNotification.mockReset();
  mocks.emitConversationUpdate.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.getUser.mockResolvedValue({
    fullName: "Fiona Freelancer",
    imageUrl: "https://example.test/f.png",
  });
});

describe("proposals contract", () => {
  it("covers submit, metadata, client list, status changes and interviews", async () => {
    const { clientId, jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();
    const brokenFreelancerId = await createFreelancer();
    const { agencyId, ownerId } = await createAgency();

    const submit = await request(app)
      .post(API)
      .set(as(freelancerId))
      .send({
        role: "freelancer",
        jobId,
        coverLetter,
        bidAmountCents: 80000,
        duration: "3 weeks",
        screeningAnswers: ["Because."],
      });
    expect(submit.status).toBe(201);
    proposalsCreateResponses[201].parse(submit.body);
    const proposalId = submit.body.data.proposal.id as string;

    const duplicate = await request(app)
      .post(API)
      .set(as(freelancerId))
      .send({
        role: "freelancer",
        jobId,
        coverLetter,
        bidAmountCents: 80000,
        duration: "3 weeks",
        screeningAnswers: ["Because."],
      });
    expect(duplicate.status).toBe(409);
    proposalsCreateResponses[409].parse(duplicate.body);

    const missingJob = await request(app).post(API).set(as(freelancerId)).send({
      role: "freelancer",
      jobId: randomUUID(),
      coverLetter,
      bidAmountCents: 80000,
      duration: "3 weeks",
    });
    expect(missingJob.status).toBe(404);
    proposalsCreateResponses[404].parse(missingJob.body);

    const [brokenProposal] = await db
      .insert(proposals)
      .values({
        job_id: jobId,
        sender_id: brokenFreelancerId,
        sender_type: "FREELANCER",
        cover_letter: "x",
        bid_amount_cents: 50000,
        duration: "1 week",
        screening_answers: [{ question: "Why you?", answer: "Because" }],
      })
      .returning({ id: proposals.id });
    const [agencyProposal] = await db
      .insert(proposals)
      .values({
        job_id: jobId,
        sender_id: agencyId,
        sender_type: "AGENCY",
        cover_letter: "agency pitch",
        bid_amount_cents: 90000,
        duration: "1 month",
        screening_answers: [{ question: "Why you?", answer: "Because" }],
      })
      .returning({ id: proposals.id });
    mocks.getUser.mockImplementation(async (id: string) => {
      if (id === brokenFreelancerId) throw new Error("clerk down");
      return { fullName: "Fiona Freelancer", imageUrl: "" };
    });

    const metadata = await request(app)
      .get(`${API}/metadata`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.proposals).toHaveLength(1);
    proposalsMetadataResponses[200].parse(metadata.body);

    const freelancerList = await request(app)
      .get(API)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(freelancerList.status).toBe(200);
    expect(freelancerList.body.data).toHaveLength(1);
    proposalsListResponses[200].parse(freelancerList.body);

    const clientList = await request(app)
      .get(API)
      .query({ ...asClient, jobId })
      .set(as(clientId));
    expect(clientList.status).toBe(200);
    expect(clientList.body.data).toHaveLength(3);
    proposalsListResponses[200].parse(clientList.body);

    const viewed = await request(app)
      .patch(`${API}/${proposalId}/status`)
      .set(as(clientId))
      .send({ role: "client" });
    expect(viewed.status).toBe(200);
    expect(viewed.body.data.status).toBe("VIEWED");
    proposalsStatusResponses[200].parse(viewed.body);

    const shortlisted = await request(app)
      .patch(`${API}/${proposalId}/status`)
      .set(as(clientId))
      .send({ role: "client", isShortlisted: true });
    expect(shortlisted.status).toBe(200);
    proposalsStatusResponses[200].parse(shortlisted.body);

    const statusMissing = await request(app)
      .patch(`${API}/${randomUUID()}/status`)
      .set(as(clientId))
      .send({ role: "client" });
    expect(statusMissing.status).toBe(404);
    proposalsStatusResponses[404].parse(statusMissing.body);

    const interview = await request(app)
      .post(`${API}/${proposalId}/interview`)
      .set(as(clientId))
      .send({ role: "client", message: "Let us talk." });
    expect(interview.status).toBe(201);
    proposalsInterviewResponses[201].parse(interview.body);

    const interviewAgain = await request(app)
      .post(`${API}/${proposalId}/interview`)
      .set(as(clientId))
      .send({ role: "client", message: "Let us talk." });
    expect(interviewAgain.status).toBe(409);
    proposalsInterviewResponses[409].parse(interviewAgain.body);

    const agencyInterview = await request(app)
      .post(`${API}/${agencyProposal!.id}/interview`)
      .set(as(clientId))
      .send({ role: "client", message: "Hello agency." });
    expect(agencyInterview.status).toBe(201);
    expect(agencyInterview.body.data.agencyId).toBe(agencyId);
    proposalsInterviewResponses[201].parse(agencyInterview.body);

    const interviewMissing = await request(app)
      .post(`${API}/${randomUUID()}/interview`)
      .set(as(clientId))
      .send({ role: "client", message: "Hi" });
    expect(interviewMissing.status).toBe(404);
    proposalsInterviewResponses[404].parse(interviewMissing.body);

    expect(brokenProposal).toBeDefined();
    expect(ownerId).toBeDefined();
  });

  it("answers 403 with the declared body for the wrong role", async () => {
    const { clientId, jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();

    const create = await request(app).post(API).set(as(clientId)).send({
      role: "client",
      jobId,
      coverLetter,
      bidAmountCents: 80000,
      duration: "3 weeks",
    });
    expect(create.status).toBe(403);
    proposalsCreateResponses[403].parse(create.body);

    const metadata = await request(app)
      .get(`${API}/metadata`)
      .query(asClient)
      .set(as(clientId));
    expect(metadata.status).toBe(403);
    proposalsMetadataResponses[403].parse(metadata.body);

    const status = await request(app)
      .patch(`${API}/${randomUUID()}/status`)
      .set(as(freelancerId))
      .send({ role: "freelancer" });
    expect(status.status).toBe(403);
    proposalsStatusResponses[403].parse(status.body);

    const interview = await request(app)
      .post(`${API}/${randomUUID()}/interview`)
      .set(as(freelancerId))
      .send({ role: "freelancer", message: "Hi" });
    expect(interview.status).toBe(403);
    proposalsInterviewResponses[403].parse(interview.body);
  });
});

const insertProposal = async (
  jobId: string,
  sender: { id: string; type: "FREELANCER" | "AGENCY" },
  coverLetterText = "I can deliver this work with care.",
) => {
  const [proposal] = await db
    .insert(proposals)
    .values({
      job_id: jobId,
      sender_id: sender.id,
      sender_type: sender.type,
      cover_letter: coverLetterText,
      bid_amount_cents: 80000,
      duration: "3 weeks",
      screening_answers: [{ question: "Why you?", answer: "Because" }],
    })
    .returning({ id: proposals.id });
  return proposal!.id;
};

const startInterview = (
  clientId: string,
  proposalId: string,
  message = "Let us talk.",
) =>
  request(app)
    .post(`${API}/${proposalId}/interview`)
    .set(as(clientId))
    .send({ role: "client", message });

const readThread = async (proposalId: string) => {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.proposal_id, proposalId));
  const rows = conversation
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversation_id, conversation.id))
        .orderBy(asc(messages.created_at))
    : [];
  const participants = conversation
    ? await db
        .select()
        .from(conversation_participants)
        .where(eq(conversation_participants.conversation_id, conversation.id))
    : [];
  return {
    conversation,
    rows,
    client: participants.find(
      (participant) => participant.participant_type === "CLIENT",
    ),
    other: participants.find(
      (participant) => participant.participant_type !== "CLIENT",
    ),
    participantCount: participants.length,
  };
};

describe("interview conversation writes", () => {
  it("writes the cover letter and the opening message in order and sets read state", async () => {
    const { clientId, jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();
    const proposalId = await insertProposal(
      jobId,
      { id: freelancerId, type: "FREELANCER" },
      "Cover letter for the interview.",
    );
    const startedAt = Date.now();

    const response = await startInterview(clientId, proposalId, "Hello there.");

    expect(response.status).toBe(201);
    const thread = await readThread(proposalId);
    expect(thread.conversation).toMatchObject({
      job_id: jobId,
      proposal_id: proposalId,
      context_key: `job:${jobId}:client:${clientId}:talent:${freelancerId}`,
    });
    expect(thread.rows).toHaveLength(2);
    const [proposalMessage, openingMessage] = thread.rows;
    expect(proposalMessage).toMatchObject({
      sender_id: freelancerId,
      body: "Cover letter for the interview.",
      reply_to_message_id: null,
    });
    expect(openingMessage).toMatchObject({
      sender_id: clientId,
      body: "Hello there.",
      reply_to_message_id: proposalMessage!.id,
    });
    expect(openingMessage!.created_at!.getTime()).toBe(
      proposalMessage!.created_at!.getTime() + 1,
    );
    expect(thread.conversation!.last_message_id).toBe(openingMessage!.id);
    expect(thread.conversation!.last_message_at?.getTime()).toBe(
      openingMessage!.created_at!.getTime(),
    );
    expect(thread.conversation!.updated_at!.getTime()).toBeGreaterThanOrEqual(
      startedAt,
    );
    expect(thread.participantCount).toBe(2);
    expect(thread.client).toMatchObject({
      account_id: clientId,
      last_read_message_id: openingMessage!.id,
      unread_count: 0,
    });
    expect(thread.client!.last_read_at!.getTime()).toBeGreaterThanOrEqual(
      startedAt,
    );
    expect(thread.other).toMatchObject({
      account_id: freelancerId,
      participant_type: "FREELANCER",
      unread_count: 1,
      last_read_message_id: null,
    });
  });

  it("writes the same thread for an agency proposal under the agency participant", async () => {
    const { clientId, jobId } = await createClientWithJob();
    const { ownerId, agencyId } = await createAgency();
    const proposalId = await insertProposal(
      jobId,
      { id: agencyId, type: "AGENCY" },
      "Agency cover letter for the interview.",
    );

    const response = await startInterview(clientId, proposalId, "Hi agency.");

    expect(response.status).toBe(201);
    const thread = await readThread(proposalId);
    expect(thread.conversation!.context_key).toBe(
      `job:${jobId}:client:${clientId}:agency:${agencyId}`,
    );
    expect(thread.rows.map((row) => row.sender_id)).toEqual([
      ownerId,
      clientId,
    ]);
    expect(thread.rows[1]!.reply_to_message_id).toBe(thread.rows[0]!.id);
    expect(thread.client).toMatchObject({ unread_count: 0 });
    expect(thread.other).toMatchObject({
      agency_id: agencyId,
      participant_type: "AGENCY",
      account_id: null,
      unread_count: 1,
    });
  });

  it("reuses a conversation that already has the context key and keeps its participants", async () => {
    const { clientId, jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();
    const proposalId = await insertProposal(jobId, {
      id: freelancerId,
      type: "FREELANCER",
    });
    const [existing] = await db
      .insert(conversations)
      .values({
        job_id: jobId,
        context_key: `job:${jobId}:client:${clientId}:talent:${freelancerId}`,
      })
      .returning({ id: conversations.id });
    await db.insert(conversation_participants).values([
      {
        conversation_id: existing!.id,
        account_id: clientId,
        participant_type: "CLIENT",
        unread_count: 4,
      },
      {
        conversation_id: existing!.id,
        account_id: freelancerId,
        participant_type: "FREELANCER",
        unread_count: 3,
      },
    ]);

    const response = await startInterview(clientId, proposalId);

    expect(response.status).toBe(201);
    const thread = await readThread(proposalId);
    expect(thread.conversation!.id).toBe(existing!.id);
    expect(thread.participantCount).toBe(2);
    expect(thread.rows).toHaveLength(2);
    expect(thread.client!.unread_count).toBe(0);
    expect(thread.other!.unread_count).toBe(4);
    const sameKey = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        eq(
          conversations.context_key,
          `job:${jobId}:client:${clientId}:talent:${freelancerId}`,
        ),
      );
    expect(sameKey).toHaveLength(1);
  });
});

describe("connects around proposals", () => {
  const balanceOf = async (
    owner: { freelancerId: string } | { agencyId: string },
  ) => {
    const [row] = await db
      .select()
      .from(connects)
      .where(
        "freelancerId" in owner
          ? eq(connects.freelancer_id, owner.freelancerId)
          : eq(connects.agency_id, owner.agencyId),
      );
    return row!;
  };

  const historyOf = (connectsId: string) =>
    db
      .select()
      .from(connects_history)
      .where(eq(connects_history.connects_id, connectsId))
      .orderBy(asc(connects_history.created_at));

  const submitAsFreelancer = (freelancerId: string, jobId: string) =>
    request(app)
      .post(API)
      .set(as(freelancerId))
      .send({
        role: "freelancer",
        jobId,
        coverLetter,
        bidAmountCents: 80000,
        duration: "3 weeks",
        screeningAnswers: ["Because."],
      });

  const submitAsAgency = (ownerId: string, jobId: string) =>
    request(app)
      .post("/api/v1/agency/proposals")
      .query({ role: "freelancer" })
      .set(as(ownerId))
      .send({
        jobId,
        coverLetter,
        bidAmountCents: 80000,
        duration: "3 weeks",
        screeningAnswers: ["Because."],
      });

  it("charges the freelancer's own balance and records a negative history row", async () => {
    const { jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();
    const bystander = await createFreelancer();
    const { agencyId } = await createAgency();
    const bystanderBefore = await balanceOf({ freelancerId: bystander });
    const agencyBefore = await balanceOf({ agencyId });
    const startedAt = Date.now();

    const response = await submitAsFreelancer(freelancerId, jobId);

    expect(response.status).toBe(201);
    const after = await balanceOf({ freelancerId });
    expect(after.connects).toBe(100 - PROPOSAL_CONNECTS);
    expect(after.updated_at!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(response.body.data.connects).toBe(100 - PROPOSAL_CONNECTS);
    const history = await historyOf(after.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "Proposal submitted",
      description: "Proposal job",
      amount: -PROPOSAL_CONNECTS,
    });
    expect(await balanceOf({ freelancerId: bystander })).toEqual(
      bystanderBefore,
    );
    expect(await balanceOf({ agencyId })).toEqual(agencyBefore);
  });

  it("charges the agency's balance for an agency submission", async () => {
    const { jobId } = await createClientWithJob();
    const { ownerId, agencyId } = await createAgency();
    const bystander = await createFreelancer();
    const bystanderBefore = await balanceOf({ freelancerId: bystander });
    const startedAt = Date.now();

    const response = await submitAsAgency(ownerId, jobId);

    expect(response.status).toBe(201);
    const after = await balanceOf({ agencyId });
    expect(after.connects).toBe(100 - PROPOSAL_CONNECTS);
    expect(after.updated_at!.getTime()).toBeGreaterThanOrEqual(startedAt);
    const history = await historyOf(after.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "Proposal submitted",
      description: "Proposal job",
      amount: -PROPOSAL_CONNECTS,
    });
    expect(await balanceOf({ freelancerId: bystander })).toEqual(
      bystanderBefore,
    );
  });

  it.each(["freelancer", "agency"] as const)(
    "answers 400 for a %s balance one connect short and changes nothing",
    async (kind) => {
      const { jobId } = await createClientWithJob();
      const freelancerId = await createFreelancer();
      const { ownerId, agencyId } = await createAgency();
      const owner = kind === "freelancer" ? { freelancerId } : { agencyId };
      await db
        .update(connects)
        .set({ connects: PROPOSAL_CONNECTS - 1 })
        .where(
          kind === "freelancer"
            ? eq(connects.freelancer_id, freelancerId)
            : eq(connects.agency_id, agencyId),
        );
      const before = await balanceOf(owner);

      const response =
        kind === "freelancer"
          ? await submitAsFreelancer(freelancerId, jobId)
          : await submitAsAgency(ownerId, jobId);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        message: "Not enough Connects.",
      });
      expect(await balanceOf(owner)).toEqual(before);
      expect(await historyOf(before.id)).toHaveLength(0);
      expect(
        await db.select().from(proposals).where(eq(proposals.job_id, jobId)),
      ).toHaveLength(0);
    },
  );

  it("charges exactly the cost when the balance equals it", async () => {
    const { jobId } = await createClientWithJob();
    const freelancerId = await createFreelancer();
    await db
      .update(connects)
      .set({ connects: PROPOSAL_CONNECTS })
      .where(eq(connects.freelancer_id, freelancerId));

    const response = await submitAsFreelancer(freelancerId, jobId);

    expect(response.status).toBe(201);
    expect((await balanceOf({ freelancerId })).connects).toBe(0);
  });

  it.each(["freelancer", "agency"] as const)(
    "leaves the %s balance and history unchanged when the duplicate proposal answers 409",
    async (kind) => {
      const { jobId } = await createClientWithJob();
      const freelancerId = await createFreelancer();
      const { ownerId, agencyId } = await createAgency();
      const owner = kind === "freelancer" ? { freelancerId } : { agencyId };
      const submit = () =>
        kind === "freelancer"
          ? submitAsFreelancer(freelancerId, jobId)
          : submitAsAgency(ownerId, jobId);
      expect((await submit()).status).toBe(201);
      const afterFirst = await balanceOf(owner);

      const duplicate = await submit();

      expect(duplicate.status).toBe(409);
      expect(await balanceOf(owner)).toEqual(afterFirst);
      expect(await historyOf(afterFirst.id)).toHaveLength(1);
    },
  );

  it.each(["freelancer", "agency"] as const)(
    "credits the %s balance and records the refund when an interview starts",
    async (kind) => {
      const { clientId, jobId } = await createClientWithJob();
      const freelancerId = await createFreelancer();
      const { agencyId } = await createAgency();
      const bystander = await createFreelancer();
      const bystanderBefore = await balanceOf({ freelancerId: bystander });
      const otherOwner =
        kind === "freelancer" ? { agencyId } : { freelancerId };
      const otherBefore = await balanceOf(otherOwner);
      const proposalId = await insertProposal(
        jobId,
        kind === "freelancer"
          ? { id: freelancerId, type: "FREELANCER" }
          : { id: agencyId, type: "AGENCY" },
      );
      const owner = kind === "freelancer" ? { freelancerId } : { agencyId };
      await db
        .update(connects)
        .set({ connects: 0 })
        .where(
          kind === "freelancer"
            ? eq(connects.freelancer_id, freelancerId)
            : eq(connects.agency_id, agencyId),
        );
      const before = await balanceOf(owner);
      const startedAt = Date.now();

      const response = await startInterview(clientId, proposalId);

      expect(response.status).toBe(201);
      const after = await balanceOf(owner);
      expect(after.connects).toBe(before.connects + PROPOSAL_CONNECTS);
      expect(after.updated_at!.getTime()).toBeGreaterThanOrEqual(startedAt);
      expect(response.body.data.connects).toBe(after.connects);
      const history = await historyOf(after.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        type: "Interview started refund",
        description: "Proposal job",
        amount: PROPOSAL_CONNECTS,
      });
      expect(await balanceOf(otherOwner)).toEqual(otherBefore);
      expect(await balanceOf({ freelancerId: bystander })).toEqual(
        bystanderBefore,
      );

      const again = await startInterview(clientId, proposalId);
      expect(again.status).toBe(409);
      expect(await balanceOf(owner)).toEqual(after);
      expect(await historyOf(after.id)).toHaveLength(1);
    },
  );
});
