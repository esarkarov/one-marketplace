import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../../database/client.js";
import {
  accounts,
  agency_earning,
  agency_metadata,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { searchPublicAgencies } from "../services/agency.search.service.js";

const { app } = await import("../../../app.js");

const PREFIX = "agency-page-it-";
const like = `${PREFIX}%`;
const TIED_AT = new Date("2024-01-01T00:00:00.000Z");
const SORTS = ["recommended", "rating", "projects"] as const;

const purge = async () => {
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

const seedTiedAgencies = async (specialty: string, total: number) => {
  const ids: string[] = [];
  for (let index = 0; index < total; index += 1) {
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
        overview: "page test agency",
        is_onboarded: true,
        created_at: TIED_AT,
      })
      .returning({ id: agency_metadata.id });
    await db.insert(agency_earning).values({
      agency_id: agency!.id,
      rating: "4.00",
      job_success_score: "80.00",
      completed_jobs: 3,
      review_count: 2,
    });
    ids.push(agency!.id);
  }
  return ids;
};

describe("searchPublicAgencies paging against Postgres", () => {
  it("reports hasMore only when a row exists beyond the limit", async () => {
    const specialty = `${PREFIX}${randomUUID()}`;
    await seedTiedAgencies(specialty, 5);
    const filters = { specialty };

    const exact = await searchPublicAgencies(filters, { limit: 5, offset: 0 });
    const below = await searchPublicAgencies(filters, { limit: 4, offset: 0 });
    const above = await searchPublicAgencies(filters, { limit: 6, offset: 0 });
    const lastPage = await searchPublicAgencies(filters, {
      limit: 2,
      offset: 3,
    });

    expect(exact.results).toHaveLength(5);
    expect(exact.hasMore).toBe(false);
    expect(below.results).toHaveLength(4);
    expect(below.hasMore).toBe(true);
    expect(above.results).toHaveLength(5);
    expect(above.hasMore).toBe(false);
    expect(lastPage.results).toHaveLength(2);
    expect(lastPage.hasMore).toBe(false);
  });

  it.each(SORTS)(
    "orders rows with identical sort keys by id ascending across pages (sort %s)",
    async (sort) => {
      const specialty = `${PREFIX}${randomUUID()}`;
      const seeded = await seedTiedAgencies(specialty, 7);
      const filters = { specialty, sort };

      const paged: string[] = [];
      for (let offset = 0; offset < seeded.length; offset += 3) {
        const page = await searchPublicAgencies(filters, { limit: 3, offset });
        paged.push(...page.results.map((row) => row.id));
      }

      expect(paged).toEqual([...seeded].sort());
    },
  );

  it("honours the limit query parameter on GET /agency/search", async () => {
    const specialty = `${PREFIX}${randomUUID()}`;
    await seedTiedAgencies(specialty, 5);

    const limited = await request(app)
      .get("/api/v1/agency/search")
      .query({ specialty, limit: "2" });
    const defaulted = await request(app)
      .get("/api/v1/agency/search")
      .query({ specialty });
    const tooLarge = await request(app)
      .get("/api/v1/agency/search")
      .query({ specialty, limit: "101" });

    expect(limited.status).toBe(200);
    expect(limited.body.data.results).toHaveLength(2);
    expect(limited.body.data.hasMore).toBe(true);
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.data.results).toHaveLength(5);
    expect(defaulted.body.data.hasMore).toBe(false);
    expect(tooLarge.status).toBe(400);
  });
});
