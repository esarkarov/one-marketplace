import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import { accounts, job_posts } from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  findOwnedJobStatus,
  markJobHired,
} from "@/modules/jobs/repositories/jobs.repository.js";

const PREFIX = "jobs-hired-guard-";
const like = `${PREFIX}%`;

const purge = async () => {
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

beforeEach(async () => {
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

const insertJob = async (status: string) => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: "Guarded job",
      description: "guard",
      expertise_level: "INTERMEDIATE",
      expected_duration: "1 week",
      total_budget_cents: 100,
      status,
      milestones: [],
    })
    .returning({ id: job_posts.id });
  return { clientId, jobId: job!.id };
};

const statusOf = async (jobId: string) =>
  (await db.select().from(job_posts).where(eq(job_posts.id, jobId)))[0]!.status;

describe("markJobHired", () => {
  it("hires a PUBLISHED job once and returns its id", async () => {
    const { jobId } = await insertJob("PUBLISHED");

    expect(await markJobHired(db, jobId)).toEqual({ id: jobId });
    expect(await statusOf(jobId)).toBe("HIRED");
    expect(await markJobHired(db, jobId)).toBeUndefined();
    expect(await statusOf(jobId)).toBe("HIRED");
  });

  it("does not change a job that is not PUBLISHED", async () => {
    const draft = await insertJob("DRAFT");

    expect(await markJobHired(db, draft.jobId)).toBeUndefined();
    expect(await statusOf(draft.jobId)).toBe("DRAFT");
  });

  it("lets exactly one of two concurrent hires win", async () => {
    const { jobId } = await insertJob("PUBLISHED");

    const results = await Promise.all([
      markJobHired(db, jobId),
      markJobHired(db, jobId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("findOwnedJobStatus", () => {
  it("returns the status only for the owner", async () => {
    const { clientId, jobId } = await insertJob("HIRED");

    expect(await findOwnedJobStatus(db, clientId, jobId)).toEqual({
      status: "HIRED",
    });
    expect(
      await findOwnedJobStatus(db, `${PREFIX}intruder`, jobId),
    ).toBeUndefined();
  });
});
