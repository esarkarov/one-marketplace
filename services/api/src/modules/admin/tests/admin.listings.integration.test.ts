import { randomUUID } from "node:crypto";
import { count, like as likeOp } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../../database/client.js";
import {
  accounts,
  agency_metadata,
  job_posts,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  getAdminAccounts,
  getAdminJobPosts,
} from "../services/admin.listings.service.js";

const PREFIX = "admin-listings-it-";
const like = `${PREFIX}%`;
const TIED_AT = new Date("2024-01-01T00:00:00.000Z");

const purge = async () => {
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
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

const seedTiedAccountsAndAgencies = async (
  people: number,
  agencyCount: number,
) => {
  const authIds = Array.from(
    { length: people },
    () => `${PREFIX}${randomUUID()}`,
  );
  const inserted = await db
    .insert(accounts)
    .values(
      authIds.map((authId) => ({
        auth_id: authId,
        email: `${authId}@example.test`,
        role: "FREELANCER" as const,
        created_at: TIED_AT,
      })),
    )
    .returning({ id: accounts.id, authId: accounts.auth_id });
  const agencies = await db
    .insert(agency_metadata)
    .values(
      authIds.slice(0, agencyCount).map((ownerId) => ({
        owner_id: ownerId,
        name: `${PREFIX}agency-${randomUUID()}`,
        size: "1-10",
        specialty: "testing",
        overview: "tie test",
        is_onboarded: true,
        created_at: TIED_AT,
      })),
    )
    .returning({ id: agency_metadata.id });
  return { people: inserted, agencies };
};

describe("admin ids against Postgres", () => {
  it("returns the client accounts.id on job posts, never the Clerk id", async () => {
    const seeded = await seedJobs(1);
    const [client] = await db
      .select({ id: accounts.id, authId: accounts.auth_id })
      .from(accounts)
      .where(likeOp(accounts.auth_id, like));
    const { results } = await getAdminJobPosts({ limit: 100, offset: 0 });
    const row = results.find((job) => job.id === seeded[0]);

    expect(row?.clientId).toBe(client!.id);
    expect(row?.clientId).not.toBe(client!.authId);
  });

  it("orders accounts and agencies with an identical created_at by public id across pages", async () => {
    const seeded = await seedTiedAccountsAndAgencies(6, 3);
    const expected = [
      ...seeded.people.map((row) => row.id),
      ...seeded.agencies.map((row) => row.id),
    ]
      .sort()
      .reverse();

    const paged: Awaited<ReturnType<typeof getAdminAccounts>>["results"] = [];
    for (let offset = 0; ; offset += 4) {
      const page = await getAdminAccounts({ limit: 4, offset });
      paged.push(...page.results);
      if (!page.hasMore) break;
    }
    const mine = paged.filter((row) => expected.includes(row.id));

    expect(new Set(paged.map((row) => row.id)).size).toBe(paged.length);
    expect(mine.map((row) => row.id)).toEqual(expected);
    const personAuthIds = new Map(
      seeded.people.map((row) => [row.id, row.authId]),
    );
    mine.forEach((row) => {
      expect(row.authId).toBe(
        row.type === "AGENCY" ? null : personAuthIds.get(row.id),
      );
    });
  });
});
