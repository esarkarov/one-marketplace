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
  emitConversationUpdate: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
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
  agency_members,
  agency_metadata,
  client_metadata,
  client_spents,
  connects,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  proposals,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
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
