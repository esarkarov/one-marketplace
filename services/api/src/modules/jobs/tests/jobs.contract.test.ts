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

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      imageKitPrivateKey: "ik_test",
    },
  };
});

vi.mock("../../../infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../../infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: mocks.remove } },
}));

vi.mock("../../../infrastructure/cache/redis.client.js", () => ({
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

import { db, pool } from "../../../database/client.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  freelancer_metadata,
  freelancer_saved_job_posts,
  job_posts,
  proposals,
} from "../../../test/support/tables.js";
import { expectNoClerkIds } from "../../../test/support/clerk-id-scan.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
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
} from "../responses/jobs.responses.js";

const { app } = await import("../../../app.js");

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
  await pool.query("delete from contracts where client_id like $1", [like]);
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
  expertiseLevel: "EXPERT",
  expectedDuration: "1 month",
  skills: ["node", "postgres"],
  milestones: [
    { title: "First", budgetCents: 50000, dueDate: dueDate(10) },
    { title: "Second", budgetCents: 30000, dueDate: dueDate(20) },
  ],
  screeningQuestions: ["Why you?"],
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
    expect(list.body.data.results[0].proposalCount).toBe(1);
    expect(list.body.data.results[0].shortlistCount).toBe(1);
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
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      success: false,
      message: "Job post not found.",
      code: "JOB_NOT_FOUND",
      requestId: expect.any(String),
    });
    jobsGetResponses[404].parse(missing.body);

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
    expect(removed.body).toHaveProperty("data", null);
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
    expect(list.body.data.results).toHaveLength(1);
    expect(list.body.data.hasMore).toBe(false);
    jobsSavedListResponses[200].parse(list.body);

    const removed = await request(app)
      .delete(`${API}/saved/${jobId}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(removed.status).toBe(200);
    expect(removed.body.data).toBeNull();
    expect(removed.body).toHaveProperty("data", null);
    jobsUnsaveResponses[200].parse(removed.body);

    const removedAgain = await request(app)
      .delete(`${API}/saved/${jobId}`)
      .query(asFreelancer)
      .set(as(freelancerId));
    expect(removedAgain.status).toBe(404);
    jobsUnsaveResponses[404].parse(removedAgain.body);
  });

  it("rejects an unknown status on create and update with 400 VALIDATION_ERROR", async () => {
    const clientId = await seedClient();
    const create = await request(app)
      .post(API)
      .set(as(clientId))
      .send(jobBody({ status: "ARCHIVED" }));
    expect(create.status).toBe(400);
    expect(create.body.code).toBe("VALIDATION_ERROR");
    expect(create.body.errors).toEqual([
      { path: "body.status", message: "Status must be DRAFT or PUBLISHED." },
    ]);

    const created = await request(app)
      .post(API)
      .set(as(clientId))
      .send(jobBody());
    expect(created.status).toBe(201);
    const update = await request(app)
      .put(`${API}/${created.body.data.id}`)
      .set(as(clientId))
      .send(jobBody({ status: "ARCHIVED" }));
    expect(update.status).toBe(400);
    expect(update.body.code).toBe("VALIDATION_ERROR");
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

describe("jobs queries against real Postgres", () => {
  beforeEach(async () => {
    await purge();
  });

  interface ClientOptions {
    rating?: string | null;
    paymentVerified?: boolean;
  }

  const seedClientWith = async (options: ClientOptions = {}) => {
    const clientId = await insertAccount(newAuthId(), "CLIENT", {
      paymentMethodVerified: options.paymentVerified ?? true,
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
    if (options.rating !== null) {
      await db.insert(client_spents).values({
        client_id: clientId,
        total_spent_cents: 90000,
        completed_contracts: 1,
        review_count: 1,
        rating: options.rating ?? "4.00",
      });
    }
    return clientId;
  };

  const seedFreelancer = async () => {
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
    return freelancerId;
  };

  const jobValues = (
    clientId: string,
    overrides: Partial<typeof job_posts.$inferInsert> = {},
  ): typeof job_posts.$inferInsert => ({
    client_id: clientId,
    title: `${PREFIX}job-${randomUUID()}`,
    description: "Node work",
    expertise_level: "EXPERT",
    expected_duration: "1 month",
    skills: ["node"],
    total_budget_cents: 80000,
    milestones: [
      {
        id: randomUUID(),
        title: "M1",
        budgetCents: 80000,
        dueDate: dueDate(10),
      },
    ],
    status: "PUBLISHED",
    published_at: new Date(),
    ...overrides,
  });

  const insertJob = async (
    clientId: string,
    overrides: Partial<typeof job_posts.$inferInsert> = {},
  ) => {
    const [job] = await db
      .insert(job_posts)
      .values(jobValues(clientId, overrides))
      .returning();
    return job!;
  };

  const addProposal = async (jobId: string, shortlisted = false) => {
    const [proposal] = await db
      .insert(proposals)
      .values({
        job_id: jobId,
        sender_id: newAuthId(),
        sender_type: "FREELANCER",
        cover_letter: "hello",
        bid_amount_cents: 1000,
        duration: "1 month",
        is_shortlisted: shortlisted,
      })
      .returning({ id: proposals.id });
    return proposal!.id;
  };

  const addContract = async (
    clientId: string,
    freelancerId: string,
    jobId: string,
    status: "PENDING" | "ACTIVE" | "COMPLETED",
  ) => {
    const proposalId = await addProposal(jobId);
    await db.insert(contracts).values({
      proposal_id: proposalId,
      job_id: jobId,
      client_id: clientId,
      freelancer_id: freelancerId,
      title: "Contract",
      total_amount_cents: 1000,
      status,
    });
  };

  const readJob = async (jobId: string) => {
    const [job] = await db
      .select()
      .from(job_posts)
      .where(eq(job_posts.id, jobId));
    return job;
  };

  describe("client job list and lookup", () => {
    it("lists only the client's own jobs newest first with proposal, shortlist and hire counts", async () => {
      const clientA = await seedClientWith();
      const clientB = await seedClientWith();
      const freelancerId = await insertAccount(newAuthId(), "FREELANCER");
      const oldest = await insertJob(clientA, {
        created_at: new Date("2024-01-01"),
      });
      const middle = await insertJob(clientA, {
        created_at: new Date("2024-02-01"),
      });
      const newest = await insertJob(clientA, {
        created_at: new Date("2024-03-01"),
      });
      await insertJob(clientB, { created_at: new Date("2024-04-01") });
      const fillers = [];
      for (const month of [
        "2023-05",
        "2023-09",
        "2023-03",
        "2023-11",
        "2023-07",
      ]) {
        fillers.push(
          await insertJob(clientA, { created_at: new Date(`${month}-01`) }),
        );
      }
      await addProposal(middle.id, true);
      await addProposal(middle.id, false);
      await addContract(clientA, freelancerId, middle.id, "ACTIVE");
      await addContract(clientA, freelancerId, middle.id, "COMPLETED");
      await addContract(clientA, freelancerId, middle.id, "PENDING");

      const response = await request(app)
        .get(API)
        .query(asClient)
        .set(as(clientA));

      expect(response.status).toBe(200);
      const rows = response.body.data.results as Array<{
        id: string;
        proposalCount: number;
        shortlistCount: number;
        hireCount: number;
      }>;
      expect(rows.map((row) => row.id)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
        ...[...fillers]
          .sort((a, b) => b.created_at!.getTime() - a.created_at!.getTime())
          .map((job) => job.id),
      ]);
      const counted = rows.find((row) => row.id === middle.id)!;
      expect(counted).toMatchObject({
        proposalCount: 5,
        shortlistCount: 1,
        hireCount: 2,
      });
      const empty = rows.find((row) => row.id === oldest.id)!;
      expect(empty).toMatchObject({
        proposalCount: 0,
        shortlistCount: 0,
        hireCount: 0,
      });
    });

    it("returns a single job only to its owner", async () => {
      const clientA = await seedClientWith();
      const clientB = await seedClientWith();
      const own = await insertJob(clientA);
      const foreign = await insertJob(clientB);

      const mine = await request(app)
        .get(`${API}/${own.id}`)
        .query(asClient)
        .set(as(clientA));
      const theirs = await request(app)
        .get(`${API}/${foreign.id}`)
        .query(asClient)
        .set(as(clientA));

      expect(mine.body.data.id).toBe(own.id);
      expect(theirs.status).toBe(404);
      expect(theirs.body.code).toBe("JOB_NOT_FOUND");
    });
  });

  describe("client job writes", () => {
    it("stores the uploaded attachment references instead of the request payload", async () => {
      const clientId = await seedClientWith();

      const response = await request(app)
        .post(API)
        .set(as(clientId))
        .send(jobBody());

      expect(response.status).toBe(201);
      const [stored] = response.body.data.attachments;
      expect(stored.fileUrl).toBe("https://ik.example.test/brief.png");
      expect(stored.fileId).toMatch(/^file_/);
      const row = await readJob(response.body.data.id);
      expect(row!.attachments).toEqual(response.body.data.attachments);
    });

    it("stores the update, bumps updated_at and leaves the client's other jobs alone", async () => {
      const clientId = await seedClientWith();
      const target = await insertJob(clientId, {
        updated_at: new Date("2020-01-01"),
      });
      const other = await insertJob(clientId, { title: "Untouched" });

      const response = await request(app)
        .put(`${API}/${target.id}`)
        .set(as(clientId))
        .send(jobBody({ title: "Renamed", attachments: [] }));

      expect(response.status).toBe(200);
      const updated = await readJob(target.id);
      expect(updated!.title).toBe("Renamed");
      expect(updated!.updated_at!.getTime()).toBeGreaterThan(
        new Date("2021-01-01").getTime(),
      );
      expect((await readJob(other.id))!.title).toBe("Untouched");
    });

    it("answers 409 JOB_LOCKED for a hired job before uploading anything", async () => {
      const clientId = await seedClientWith();
      const job = await insertJob(clientId, {
        title: "Hired",
        status: "HIRED",
      });

      const response = await request(app)
        .put(`${API}/${job.id}`)
        .set(as(clientId))
        .send(jobBody({ title: "Changed" }));

      expect(response.status).toBe(409);
      jobsUpdateResponses[409].parse(response.body);
      expect(response.body.code).toBe("JOB_LOCKED");
      expect(mocks.upload).not.toHaveBeenCalled();
      expect((await readJob(job.id))!.title).toBe("Hired");
    });

    it("answers 404 for another client's job before uploading anything", async () => {
      const owner = await seedClientWith();
      const intruder = await seedClientWith();
      const job = await insertJob(owner, { title: "Mine" });

      const response = await request(app)
        .put(`${API}/${job.id}`)
        .set(as(intruder))
        .send(jobBody({ title: "Hijacked" }));

      expect(response.status).toBe(404);
      expect(mocks.upload).not.toHaveBeenCalled();
      expect((await readJob(job.id))!.title).toBe("Mine");
    });

    it("answers 409 and removes the upload when the job is hired during the upload", async () => {
      const clientId = await seedClientWith();
      const job = await insertJob(clientId, { title: "Before" });
      mocks.upload.mockImplementation(async () => {
        await pool.query(
          "update job_posts set status = 'HIRED' where id = $1",
          [job.id],
        );
        return { fileId: "file_hired", url: "https://ik.example.test/x.png" };
      });

      const response = await request(app)
        .put(`${API}/${job.id}`)
        .set(as(clientId))
        .send(jobBody({ title: "After" }));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("JOB_LOCKED");
      expect(mocks.remove).toHaveBeenCalledWith("file_hired");
      expect((await readJob(job.id))!.title).toBe("Before");
    });

    it("answers 404 when the job changes owner during the upload", async () => {
      const clientId = await seedClientWith();
      const newOwner = await seedClientWith();
      const job = await insertJob(clientId, { title: "Before" });
      mocks.upload.mockImplementation(async () => {
        await pool.query("update job_posts set client_id = $2 where id = $1", [
          job.id,
          newOwner,
        ]);
        return { fileId: "file_moved", url: "https://ik.example.test/x.png" };
      });

      const response = await request(app)
        .put(`${API}/${job.id}`)
        .set(as(clientId))
        .send(jobBody({ title: "After" }));

      expect(response.status).toBe(404);
      expect(mocks.remove).toHaveBeenCalledWith("file_moved");
      expect((await readJob(job.id))!.title).toBe("Before");
    });

    it("does not delete a hired job", async () => {
      const clientId = await seedClientWith();
      const job = await insertJob(clientId, { status: "HIRED" });

      const response = await request(app)
        .delete(`${API}/${job.id}`)
        .query(asClient)
        .set(as(clientId));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("JOB_LOCKED");
      expect(await readJob(job.id)).toBeDefined();
    });

    it("does not delete another client's job", async () => {
      const owner = await seedClientWith();
      const intruder = await seedClientWith();
      const job = await insertJob(owner);

      const response = await request(app)
        .delete(`${API}/${job.id}`)
        .query(asClient)
        .set(as(intruder));

      expect(response.status).toBe(404);
      expect(await readJob(job.id)).toBeDefined();
    });
  });

  const accountUuid = async (authId: string) => {
    const { rows } = await pool.query(
      "select id from accounts where auth_id = $1",
      [authId],
    );
    return rows[0].id as string;
  };

  describe("Clerk id exposure", () => {
    it("returns accounts uuids and no Clerk id on every client and saved-job response", async () => {
      const clientId = await seedClientWith();
      const freelancerId = await seedFreelancer();
      const clientUuid = await accountUuid(clientId);
      const clerkIds = [clientId, freelancerId];

      const created = await request(app)
        .post(API)
        .set(as(clientId))
        .send(jobBody());
      expect(created.status).toBe(201);
      expect(created.body.data.clientId).toBe(clientUuid);
      expectNoClerkIds(created.body, clerkIds);
      const jobId = created.body.data.id as string;

      const list = await request(app)
        .get(API)
        .query(asClient)
        .set(as(clientId));
      expect(list.body.data.results[0].clientId).toBe(clientUuid);
      expectNoClerkIds(list.body, clerkIds);

      const one = await request(app)
        .get(`${API}/${jobId}`)
        .query(asClient)
        .set(as(clientId));
      expect(one.body.data.clientId).toBe(clientUuid);
      expectNoClerkIds(one.body, clerkIds);

      const updated = await request(app)
        .put(`${API}/${jobId}`)
        .set(as(clientId))
        .send(jobBody({ title: "Renamed" }));
      expect(updated.status).toBe(200);
      expect(updated.body.data.clientId).toBe(clientUuid);
      expectNoClerkIds(updated.body, clerkIds);

      const saved = await request(app)
        .post(`${API}/saved/${jobId}`)
        .query(asFreelancer)
        .set(as(freelancerId));
      expect(saved.status).toBe(201);
      expect(saved.body.data.freelancerId).toBe(
        await accountUuid(freelancerId),
      );
      expectNoClerkIds(saved.body, clerkIds);

      const savedList = await request(app)
        .get(`${API}/saved`)
        .query(asFreelancer)
        .set(as(freelancerId));
      expect(savedList.body.data.results[0].clientId).toBe(clientUuid);
      expectNoClerkIds(savedList.body, clerkIds);
    });
  });

  describe("saved jobs", () => {
    it("saves only published jobs, keeps saves per freelancer and job, and unsaves one at a time", async () => {
      const clientId = await seedClientWith();
      const freelancerA = await seedFreelancer();
      const freelancerB = await seedFreelancer();
      const first = await insertJob(clientId);
      const second = await insertJob(clientId);
      const draft = await insertJob(clientId, { status: "DRAFT" });
      await addProposal(first.id);
      await addProposal(first.id);
      await addProposal(second.id);
      const save = (freelancerId: string, jobId: string) =>
        request(app)
          .post(`${API}/saved/${jobId}`)
          .query(asFreelancer)
          .set(as(freelancerId));
      const unsave = (freelancerId: string, jobId: string) =>
        request(app)
          .delete(`${API}/saved/${jobId}`)
          .query(asFreelancer)
          .set(as(freelancerId));
      const savedFor = async (freelancerId: string) => {
        const response = await request(app)
          .get(`${API}/saved`)
          .query(asFreelancer)
          .set(as(freelancerId));
        return response.body.data.results as Array<{
          id: string;
          paymentVerified: boolean;
          proposalCount: number;
        }>;
      };

      expect((await save(freelancerA, draft.id)).status).toBe(404);

      expect((await save(freelancerB, first.id)).status).toBe(201);
      expect((await save(freelancerA, second.id)).status).toBe(201);
      expect((await save(freelancerA, first.id)).status).toBe(201);
      const repeated = await save(freelancerA, first.id);
      expect(repeated.status).toBe(201);
      expect(repeated.body.data).toMatchObject({
        freelancerId: await accountUuid(freelancerA),
        jobId: first.id,
      });

      const listed = await savedFor(freelancerA);
      expect(listed.map((job) => job.id)).toEqual([first.id, second.id]);
      expect(listed.map((job) => job.proposalCount)).toEqual([2, 1]);
      expect(listed.every((job) => job.paymentVerified)).toBe(true);

      expect((await unsave(freelancerB, first.id)).status).toBe(200);
      expect((await savedFor(freelancerA)).map((job) => job.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect((await unsave(freelancerA, first.id)).status).toBe(200);
      expect((await savedFor(freelancerA)).map((job) => job.id)).toEqual([
        second.id,
      ]);
    });
  });

  describe("paging", () => {
    const TIED_AT = new Date("2024-01-01T00:00:00.000Z");

    it("reports hasMore only when a row exists beyond the limit and orders ties by id descending", async () => {
      const { getJobPostsPage } = await import("../services/jobs.service.js");
      const clientId = await seedClientWith();
      const created = [];
      for (let index = 0; index < 7; index += 1) {
        created.push(await insertJob(clientId, { created_at: TIED_AT }));
      }

      const exact = await getJobPostsPage(clientId, { limit: 7, offset: 0 });
      const short = await getJobPostsPage(clientId, { limit: 6, offset: 0 });
      const over = await getJobPostsPage(clientId, { limit: 8, offset: 0 });
      const paged: string[] = [];
      for (let offset = 0; offset < 7; offset += 3) {
        const page = await getJobPostsPage(clientId, { limit: 3, offset });
        paged.push(...page.results.map((row) => row.id));
      }

      expect(exact.results).toHaveLength(7);
      expect(exact.hasMore).toBe(false);
      expect(short.results).toHaveLength(6);
      expect(short.hasMore).toBe(true);
      expect(over.hasMore).toBe(false);
      expect(paged).toEqual(
        created
          .map((job) => job.id)
          .sort()
          .reverse(),
      );
    });

    it("pages saved jobs with hasMore at the limit and orders ties by id descending", async () => {
      const { getSavedJobPosts } = await import("../services/jobs.service.js");
      const clientId = await seedClientWith();
      const freelancerId = await seedFreelancer();
      const savedIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const job = await insertJob(clientId);
        const [saved] = await db
          .insert(freelancer_saved_job_posts)
          .values({
            job_id: job.id,
            freelancer_id: freelancerId,
            created_at: TIED_AT,
          })
          .returning({ id: freelancer_saved_job_posts.id });
        savedIds.push(saved!.id);
      }

      const exact = await getSavedJobPosts(freelancerId, {
        limit: 5,
        offset: 0,
      });
      const short = await getSavedJobPosts(freelancerId, {
        limit: 4,
        offset: 0,
      });
      const ordered = await db
        .select({
          id: freelancer_saved_job_posts.id,
          jobId: freelancer_saved_job_posts.job_id,
        })
        .from(freelancer_saved_job_posts)
        .where(eq(freelancer_saved_job_posts.freelancer_id, freelancerId));
      const expectedJobs = ordered
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .map((row) => row.jobId);

      expect(exact.results).toHaveLength(5);
      expect(exact.hasMore).toBe(false);
      expect(short.results).toHaveLength(4);
      expect(short.hasMore).toBe(true);
      expect(exact.results.map((row) => row.id)).toEqual(expectedJobs);
    });
  });

  describe("public feed", () => {
    const LOW = 61_000_000;
    const feed = async (query: Record<string, string | number>) => {
      const response = await request(app).get(`${API}/public`).query(query);
      expect(response.status).toBe(200);
      return response.body.data as {
        results: Array<{
          id: string;
          proposalCount: number;
          clientRating: number;
          clientTotalSpentCents: number;
        }>;
        hasMore: boolean;
      };
    };
    const ids = (page: { results: Array<{ id: string }> }) =>
      page.results.map((row) => row.id);

    const seedFeed = async () => {
      const high = await seedClientWith({ rating: "5.00" });
      const mid = await seedClientWith({ rating: "3.00" });
      const low = await seedClientWith({
        rating: "1.00",
        paymentVerified: false,
      });
      const bare = await seedClientWith({ rating: null });
      const j1 = await insertJob(high, {
        expertise_level: "EXPERT",
        total_budget_cents: LOW + 1000,
        published_at: new Date("2024-03-01"),
      });
      const j2 = await insertJob(mid, {
        expertise_level: "INTERMEDIATE",
        total_budget_cents: LOW + 2000,
        published_at: new Date("2024-01-01"),
      });
      const draft = await insertJob(high, {
        status: "DRAFT",
        total_budget_cents: LOW + 3000,
        published_at: null,
      });
      const j4 = await insertJob(low, {
        expertise_level: "ENTRY",
        total_budget_cents: LOW + 4000,
        published_at: new Date("2024-02-01"),
      });
      const j5 = await insertJob(bare, {
        total_budget_cents: LOW + 9000,
        published_at: new Date("2024-02-15"),
      });
      await addProposal(j1.id);
      await addProposal(j1.id);
      await addProposal(j4.id);
      return { j1, j2, draft, j4, j5 };
    };
    const band = { minBudgetCents: LOW, maxBudgetCents: LOW + 6000 };

    it("lists published jobs newest first with their proposal counts", async () => {
      const { j1, j2, j4 } = await seedFeed();

      const page = await feed(band);

      expect(ids(page)).toEqual([j1.id, j4.id, j2.id]);
      expect(page.results.map((row) => row.proposalCount)).toEqual([2, 1, 0]);
      expect(page.hasMore).toBe(false);
    });

    it.each([
      ["budget", "budget", [3, 1, 0]],
      ["rating", "rating", [0, 1, 3]],
      ["proposals", "proposals", [1, 3, 0]],
    ] as const)("sorts by %s", async (_label, sort, order) => {
      const { j1, j2, j4 } = await seedFeed();
      const byIndex = [j1, j2, undefined, j4];

      const page = await feed({ ...band, sort });

      expect(ids(page)).toEqual(order.map((index) => byIndex[index]!.id));
    });

    it("filters by expertise level", async () => {
      const { j1 } = await seedFeed();

      expect(ids(await feed({ ...band, levels: "EXPERT" }))).toEqual([j1.id]);
    });

    it("filters by verified payment method", async () => {
      const { j1, j2 } = await seedFeed();

      expect(ids(await feed({ ...band, paymentVerified: "true" }))).toEqual([
        j1.id,
        j2.id,
      ]);
    });

    it("filters by minimum and maximum budget", async () => {
      const { j1, j2, j4 } = await seedFeed();

      expect(ids(await feed({ ...band, minBudgetCents: LOW + 1500 }))).toEqual([
        j4.id,
        j2.id,
      ]);
      expect(ids(await feed({ ...band, maxBudgetCents: LOW + 2500 }))).toEqual([
        j1.id,
        j2.id,
      ]);
    });

    it("filters by maximum proposals", async () => {
      const { j2, j4 } = await seedFeed();

      expect(ids(await feed({ ...band, maxProposals: 1 }))).toEqual([
        j4.id,
        j2.id,
      ]);
    });

    it("keeps jobs of clients without spending records", async () => {
      const { j5 } = await seedFeed();

      const page = await feed({
        minBudgetCents: LOW + 8000,
        maxBudgetCents: LOW + 9500,
      });

      expect(ids(page)).toEqual([j5.id]);
      expect(page.results[0]).toMatchObject({
        clientRating: 0,
        clientTotalSpentCents: 0,
      });
    });

    it("pages by twenty with an offset", async () => {
      const clientId = await seedClientWith();
      const base = 71_000_000;
      await db.insert(job_posts).values(
        Array.from({ length: 22 }, (_, index) =>
          jobValues(clientId, {
            total_budget_cents: base + index,
            published_at: new Date(Date.UTC(2024, 0, 1, 0, index)),
          }),
        ),
      );
      const range = { minBudgetCents: base, maxBudgetCents: base + 21 };

      const first = await feed(range);
      const second = await feed({ ...range, offset: 20 });

      expect(first.results).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      expect(second.results).toHaveLength(2);
      expect(second.hasMore).toBe(false);
      expect(new Set([...ids(first), ...ids(second)]).size).toBe(22);
    });
  });
});
