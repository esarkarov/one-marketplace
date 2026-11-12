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
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      imageKitPrivateKey: "ik_test",
    },
  };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: mocks.remove } },
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
  client_metadata,
  client_spents,
  freelancer_metadata,
  proposals,
} from "../../test/support/tables.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import {
  jobsCreateResponses,
  jobsDeleteResponses,
  jobsGetResponses,
  jobsListResponses,
  jobsPublicResponses,
  jobsSaveResponses,
  jobsSavedListResponses,
  jobsUnsaveResponses,
  jobsUpdateResponses,
} from "./jobs.responses.js";

const { app } = await import("../../app.js");

const PREFIX = "jobs-contract-";
const API = "/api/v1/jobs";

const newAuthId = () => `${PREFIX}${randomUUID()}`;
const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });
const asClient = { role: "client" };
const asFreelancer = { role: "freelancer" };

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const seedClient = async () => {
  const clientId = await insertAccount(newAuthId(), "CLIENT", {
    paymentMethodVerified: true,
  });
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
  await db.insert(client_spents).values({
    client_id: clientId,
    total_spent_cents: 90000,
    completed_contracts: 1,
    review_count: 1,
    rating: "4.00",
  });
  return clientId;
};

const dueDate = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const jobBody = (overrides: Record<string, unknown> = {}) => ({
  role: "client",
  title: "Build an API",
  description: "Node and postgres work",
  expertise_level: "EXPERT",
  expected_duration: "1 month",
  skills: ["node", "postgres"],
  milestones: [
    { title: "First", budgetCents: 50000, dueDate: dueDate(10) },
    { title: "Second", budgetCents: 30000, dueDate: dueDate(20) },
  ],
  screening_questions: ["Why you?"],
  attachments: [
    {
      fileName: "brief.png",
      fileUrl: PNG,
      fileType: "image/png",
      fileSize: 70,
    },
  ],
  status: "PUBLISHED",
  ...overrides,
});

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
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.verifyToken.mockImplementation(async (token: string) => ({
    sub: token,
    sid: `sess_${token}`,
  }));
  mocks.getUser.mockResolvedValue({ unsafeMetadata: { country: "DE" } });
  mocks.upload.mockImplementation(async () => ({
    fileId: `file_${randomUUID()}`,
    url: "https://ik.example.test/brief.png",
  }));
  mocks.remove.mockResolvedValue(undefined);
});

describe("jobs contract", () => {
  it("covers the client job lifecycle", async () => {
    const clientId = await seedClient();

    const created = await request(app)
      .post(API)
      .set(as(clientId))
      .send(jobBody());
    expect(created.status).toBe(201);
    expect(created.body.data.attachments).toHaveLength(1);
    jobsCreateResponses[201].parse(created.body);
    const jobId = created.body.data.id as string;

    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");
    await db.insert(proposals).values({
      job_id: jobId,
      sender_id: freelancerId,
      sender_type: "FREELANCER",
      cover_letter: "hello",
      bid_amount_cents: 80000,
      duration: "1 month",
      is_shortlisted: true,
    });

    const list = await request(app).get(API).query(asClient).set(as(clientId));
    expect(list.status).toBe(200);
    expect(list.body.data[0].proposalCount).toBe(1);
    expect(list.body.data[0].shortlistCount).toBe(1);
    jobsListResponses[200].parse(list.body);

    const one = await request(app)
      .get(`${API}/${jobId}`)
      .query(asClient)
      .set(as(clientId));
    expect(one.status).toBe(200);
    jobsGetResponses[200].parse(one.body);

    const missing = await request(app)
      .get(`${API}/${randomUUID()}`)
      .query(asClient)
      .set(as(clientId));
    expect(missing.body.data).toBeNull();
    jobsGetResponses[200].parse(missing.body);

    const updated = await request(app)
      .put(`${API}/${jobId}`)
      .set(as(clientId))
      .send(
        jobBody({
          title: "Build an API v2",
          attachments: created.body.data.attachments,
        }),
      );
    expect(updated.status).toBe(200);
    jobsUpdateResponses[200].parse(updated.body);

    const updateMissing = await request(app)
      .put(`${API}/${randomUUID()}`)
      .set(as(clientId))
      .send(jobBody({ attachments: [] }));
    expect(updateMissing.status).toBe(404);
    jobsUpdateResponses[404].parse(updateMissing.body);

    const deleteMissing = await request(app)
      .delete(`${API}/${randomUUID()}`)
      .query(asClient)
      .set(as(clientId));
    expect(deleteMissing.status).toBe(404);
    jobsDeleteResponses[404].parse(deleteMissing.body);

    await db.delete(proposals).where(eq(proposals.job_id, jobId));
    const removed = await request(app)
      .delete(`${API}/${jobId}`)
      .query(asClient)
      .set(as(clientId));
    expect(removed.status).toBe(200);
    jobsDeleteResponses[200].parse(removed.body);
  });

  it("serves the public feed and the saved-jobs endpoints", async () => {
    const clientId = await seedClient();
    const created = await request(app)
      .post(API)
      .set(as(clientId))
      .send(jobBody({ attachments: [] }));
    expect(created.status).toBe(201);
    const jobId = created.body.data.id as string;
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");
    await db.insert(freelancer_metadata).values({
      auth_id: freelancerId,
      professional_title: "Developer",
      professional_description: "desc",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30",
      experience_level: "EXPERT",
      languages: [{ language: "English", proficiency: "Fluent" }],
    });

    const feed = await request(app).get(`${API}/public`).query({
      query: "api",
    });
    expect(feed.status).toBe(200);
    expect(feed.body.data.results.length).toBeGreaterThan(0);
    jobsPublicResponses[200].parse(feed.body);

    const saved = await request(app)
      .post(`${API}/saved/${jobId}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(saved.status).toBe(201);
    jobsSaveResponses[201].parse(saved.body);

    const missingSave = await request(app)
      .post(`${API}/saved/${randomUUID()}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(missingSave.status).toBe(404);
    jobsSaveResponses[404].parse(missingSave.body);

    const list = await request(app)
      .get(`${API}/saved`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    jobsSavedListResponses[200].parse(list.body);

    const removed = await request(app)
      .delete(`${API}/saved/${jobId}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(removed.status).toBe(200);
    jobsUnsaveResponses[200].parse(removed.body);

    const removedAgain = await request(app)
      .delete(`${API}/saved/${jobId}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(removedAgain.status).toBe(404);
    jobsUnsaveResponses[404].parse(removedAgain.body);
  });

  it("answers 403 with the declared body for the wrong role", async () => {
    const clientId = await seedClient();
    const freelancerId = await insertAccount(newAuthId(), "FREELANCER");

    const create = await request(app)
      .post(API)
      .set(as(freelancerId))
      .send(jobBody({ role: "freelancer" }));
    expect(create.status).toBe(403);
    jobsCreateResponses[403].parse(create.body);

    const saved = await request(app)
      .get(`${API}/saved`)
      .query(asClient)
      .set(as(clientId));
    expect(saved.status).toBe(403);
    jobsSavedListResponses[403].parse(saved.body);
  });
});
