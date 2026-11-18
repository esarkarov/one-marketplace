import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../../database/client.js";
import { accounts, job_posts } from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { getAdminJobPosts } from "../services/admin.listings.service.js";

const PREFIX = "admin-listings-it-";
const like = `${PREFIX}%`;
const TIED_AT = new Date("2024-01-01T00:00:00.000Z");

const purge = async () => {
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

beforeEach(purge);

afterAll(async () => {
  await purge();
  await pool.end();
});

const seedJobs = async (total: number) => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
  });
  const ids: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const [job] = await db
      .insert(job_posts)
      .values({
        client_id: clientId,
        title: `${PREFIX}job`,
        description: "tie test",
        expertise_level: "INTERMEDIATE",
        expected_duration: "1 week",
        total_budget_cents: 1000,
        milestones: [],
        created_at: TIED_AT,
      })
      .returning({ id: job_posts.id });
    ids.push(job!.id);
  }
  return ids;
};

const totalJobs = async () => {
  const [row] = await db.select({ value: count() }).from(job_posts);
  return Number(row!.value);
};

describe("getAdminJobPosts against Postgres", () => {
  it("reports hasMore only when a row exists beyond the limit", async () => {
    await seedJobs(4);
    const total = await totalJobs();

    const exact = await getAdminJobPosts({ limit: total, offset: 0 });
    const below = await getAdminJobPosts({ limit: total - 1, offset: 0 });
    const above = await getAdminJobPosts({ limit: total + 1, offset: 0 });

    expect(exact.results).toHaveLength(total);
    expect(exact.hasMore).toBe(false);
    expect(below.results).toHaveLength(total - 1);
    expect(below.hasMore).toBe(true);
    expect(above.results).toHaveLength(total);
    expect(above.hasMore).toBe(false);
  });

  it("reports no more rows on the last page of an offset window", async () => {
    await seedJobs(3);
    const total = await totalJobs();

    const last = await getAdminJobPosts({ limit: 2, offset: total - 2 });
    const beforeLast = await getAdminJobPosts({ limit: 2, offset: total - 3 });

    expect(last.results).toHaveLength(2);
    expect(last.hasMore).toBe(false);
    expect(beforeLast.hasMore).toBe(true);
  });

  it("orders rows with an identical created_at by id descending, across pages", async () => {
    const seeded = await seedJobs(7);
    const total = await totalJobs();

    const paged: string[] = [];
    for (let offset = 0; offset < total; offset += 3) {
      const page = await getAdminJobPosts({ limit: 3, offset });
      paged.push(...page.results.map((row) => row.id));
    }
    const mine = paged.filter((id) => seeded.includes(id));

    expect(new Set(paged).size).toBe(paged.length);
    expect(mine).toEqual([...seeded].sort().reverse());
  });
});
