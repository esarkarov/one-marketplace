import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../../database/client.js";
import {
  accounts,
  agency_metadata,
  freelancer_metadata,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  findFreelancerSearchRows,
  findOnboardedAgencySearchRows,
} from "../repositories/client.repository.js";

const PREFIX = "client-search-";
const like = `${PREFIX}%`;
const EVERYTHING = { limit: 1_000_000, offset: 0 };
const PAGE_SIZE = 3;
const TIED_AT = new Date("2020-01-01T00:00:00.000Z");

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

const insertAccount = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
  });
  return authId;
};

const seedTiedFreelancers = async (count: number) => {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await db
      .insert(freelancer_metadata)
      .values({
        auth_id: await insertAccount(),
        professional_title: "Tied developer",
        professional_description: "tied",
        hourly_rate_cents: 100,
        country: "US",
        city: "Austin",
        availability_status: "AVAILABLE",
        weekly_availability: "30+ hours",
        experience_level: "INTERMEDIATE",
        skills: ["TypeScript"],
        languages: [{ language: "English", proficiency: "Fluent" }],
        created_at: TIED_AT,
      })
      .returning({ id: freelancer_metadata.id });
    ids.push(row!.id);
  }
  return ids;
};

const seedTiedAgencies = async (count: number) => {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await db
      .insert(agency_metadata)
      .values({
        owner_id: await insertAccount(),
        name: `${PREFIX}agency`,
        size: "1-10",
        specialty: "tied",
        overview: "tied",
        is_onboarded: true,
        created_at: TIED_AT,
      })
      .returning({ id: agency_metadata.id });
    ids.push(row!.id);
  }
  return ids;
};

const pageThrough = async (
  read: (page: { limit: number; offset: number }) => Promise<{ id: string }[]>,
) => {
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await read({ limit: PAGE_SIZE, offset });
    ids.push(...page.map((row) => row.id));
    if (page.length < PAGE_SIZE) return ids;
  }
};

describe("marketplace search repository paging with tied created_at", () => {
  it("pages freelancers exactly once in a stable order", async () => {
    const seeded = await seedTiedFreelancers(8);
    const everything = await findFreelancerSearchRows(db, EVERYTHING);
    const paged = await pageThrough((page) =>
      findFreelancerSearchRows(db, page),
    );

    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(everything.map((row) => row.id));
    expect(paged).toEqual(expect.arrayContaining(seeded));
  });

  it("pages onboarded agencies exactly once in a stable order", async () => {
    const seeded = await seedTiedAgencies(8);
    const everything = await findOnboardedAgencySearchRows(db, EVERYTHING);
    const paged = await pageThrough((page) =>
      findOnboardedAgencySearchRows(db, page),
    );

    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toEqual(everything.map((row) => row.id));
    expect(paged).toEqual(expect.arrayContaining(seeded));
  });
});
