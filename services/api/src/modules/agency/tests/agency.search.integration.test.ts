import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import {
  accounts,
  agency_earning,
  agency_metadata,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { searchAgencyRows } from "@/modules/agency/repositories/agency.search.repository.js";

const PREFIX = "agency-search-";
const like = `${PREFIX}%`;
const EVERYTHING = { limit: 100_000, offset: 0 };
const SORTS = ["recommended", "rating", "projects", "rate-low"] as const;

const purge = async () => {
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

const seedAgencies = async (
  specialty: string,
  count: number,
  withEarning: boolean,
) => {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const ownerId = `${PREFIX}${randomUUID()}`;
    await db.insert(accounts).values({
      auth_id: ownerId,
      email: `${ownerId}@example.test`,
      role: "FREELANCER",
    });
    const [agency] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: `${PREFIX}agency`,
        size: "1-10",
        specialty,
        overview: "search test agency",
        is_onboarded: true,
      })
      .returning({ id: agency_metadata.id });
    if (withEarning) {
      await db.insert(agency_earning).values({
        agency_id: agency!.id,
        rating: "4.00",
        job_success_score: "80.00",
        completed_jobs: 3,
        review_count: 2,
      });
    }
    ids.push(agency!.id);
  }
  return ids;
};

describe("searchAgencyRows paging with tied sort values", () => {
  it.each(
    SORTS.flatMap((sort) => [[sort, true] as const, [sort, false] as const]),
  )(
    "pages every row exactly once for sort %s (earning rows: %s)",
    async (sort, withEarning) => {
      const specialty = `${PREFIX}${randomUUID()}`;
      const seeded = await seedAgencies(specialty, 7, withEarning);
      const criteria = { specialty, sort };
      const everything = await searchAgencyRows(db, criteria, EVERYTHING);

      const paged: string[] = [];
      for (let offset = 0; offset < seeded.length; offset += 3) {
        const page = await searchAgencyRows(db, criteria, {
          limit: 3,
          offset,
        });
        paged.push(...page.map((row) => row.id));
      }

      expect(new Set(paged).size).toBe(paged.length);
      expect([...paged].sort()).toEqual([...seeded].sort());
      expect(paged).toEqual(everything.map((row) => row.id));
    },
  );
});
