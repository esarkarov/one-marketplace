import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import {
  accounts,
  freelancer_earning,
  freelancer_metadata,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  searchFreelancerRows,
  type TalentSearchCriteria,
} from "@/modules/freelancer/repositories/freelancer.search.repository.js";

const PREFIX = "freelancer-search-";
const like = `${PREFIX}%`;
const BAND = { minRateCents: 9_000_000, maxRateCents: 9_000_999 };
const EVERYTHING = { limit: 100_000, offset: 0 };

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
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

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    ...extra,
  });
  return authId;
};

interface Seed {
  rate: number;
  verified: boolean;
  status: string;
  earning: { rating: string; success: string; completed: number } | null;
}

const seedTalent = async (seed: Seed) => {
  const authId = await insertAccount("FREELANCER", {
    identityVerified: seed.verified,
  });
  await db.insert(freelancer_metadata).values({
    auth_id: authId,
    professional_title: "Search developer",
    professional_description: "search description",
    hourly_rate_cents: seed.rate,
    country: "US",
    city: "Austin",
    availability_status: seed.status,
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["TypeScript"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
  if (seed.earning) {
    await db.insert(freelancer_earning).values({
      freelancer_id: authId,
      rating: seed.earning.rating,
      job_success_score: seed.earning.success,
      completed_jobs: seed.earning.completed,
      review_count: 3,
    });
  }
  return authId;
};

const seedTalentPool = async () => {
  const f1 = await seedTalent({
    rate: 9_000_100,
    verified: true,
    status: "AVAILABLE",
    earning: { rating: "4.50", success: "90.00", completed: 10 },
  });
  const f2 = await seedTalent({
    rate: 9_000_200,
    verified: false,
    status: "AVAILABLE",
    earning: { rating: "3.00", success: "95.00", completed: 30 },
  });
  const f3 = await seedTalent({
    rate: 9_000_300,
    verified: true,
    status: "BUSY",
    earning: { rating: "5.00", success: "60.00", completed: 20 },
  });
  const f4 = await seedTalent({
    rate: 9_000_400,
    verified: true,
    status: "AVAILABLE",
    earning: null,
  });
  const f5 = await seedTalent({
    rate: 9_000_500,
    verified: true,
    status: "AVAILABLE",
    earning: { rating: "2.00", success: "50.00", completed: 15 },
  });
  return { f1, f2, f3, f4, f5 };
};

describe("searchFreelancerRows", () => {
  it("keeps freelancers without an earning row and returns the selected columns", async () => {
    const pool_ = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, sort: "rate-low" },
      EVERYTHING,
    );
    expect(rows.map((row) => row.authId)).toEqual([
      pool_.f1,
      pool_.f2,
      pool_.f3,
      pool_.f4,
      pool_.f5,
    ]);
    expect(rows[0]).toMatchObject({
      authId: pool_.f1,
      professionalTitle: "Search developer",
      professionalDescription: "search description",
      hourlyRateCents: 9_000_100,
      city: "Austin",
      country: "US",
      skills: ["TypeScript"],
      availabilityStatus: "AVAILABLE",
      identityVerified: true,
      rating: "4.50",
      jobSuccessScore: "90.00",
      completedJobs: 10,
      reviewCount: 3,
    });
    expect(rows[3]).toMatchObject({
      authId: pool_.f4,
      rating: null,
      jobSuccessScore: null,
      completedJobs: null,
    });
    expect(rows[2]?.availabilityStatus).toBe("BUSY");
  });

  it.each<
    [
      string,
      TalentSearchCriteria,
      (keyof Awaited<ReturnType<typeof seedTalentPool>>)[],
    ]
  >([
    ["verifiedOnly", { verifiedOnly: true }, ["f1", "f3", "f4", "f5"]],
    ["availableOnly", { availableOnly: true }, ["f1", "f2", "f4", "f5"]],
    ["minRating", { minRating: 4 }, ["f1", "f3"]],
    ["minSuccess", { minSuccess: 80 }, ["f1", "f2"]],
    [
      "minRateCents",
      { minRateCents: 9_000_300, maxRateCents: 9_000_999 },
      ["f3", "f4", "f5"],
    ],
    [
      "maxRateCents",
      { minRateCents: 9_000_000, maxRateCents: 9_000_300 },
      ["f1", "f2", "f3"],
    ],
  ])("filters by %s", async (_name, criteria, expected) => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, ...criteria, sort: "rate-low" },
      EVERYTHING,
    );
    expect(rows.map((row) => row.authId)).toEqual(
      expected.map((key) => talent[key]),
    );
  });

  it.each<
    [
      string,
      TalentSearchCriteria["sort"],
      (keyof Awaited<ReturnType<typeof seedTalentPool>>)[],
    ]
  >([
    ["recommended", "recommended", ["f4", "f1", "f3", "f2", "f5"]],
    ["rating", "rating", ["f4", "f3", "f1", "f2", "f5"]],
    ["success", "success", ["f4", "f2", "f1", "f3", "f5"]],
    ["projects", "projects", ["f4", "f2", "f3", "f5", "f1"]],
    ["rate-low", "rate-low", ["f1", "f2", "f3", "f4", "f5"]],
  ])("sorts by %s", async (_name, sort, expected) => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(db, { ...BAND, sort }, EVERYTHING);
    expect(rows.map((row) => row.authId)).toEqual(
      expected.map((key) => talent[key]),
    );
  });

  it("applies limit and offset to the sorted rows", async () => {
    const talent = await seedTalentPool();
    const rows = await searchFreelancerRows(
      db,
      { ...BAND, sort: "rate-low" },
      { limit: 2, offset: 1 },
    );
    expect(rows.map((row) => row.authId)).toEqual([talent.f2, talent.f3]);
  });
});

describe("searchFreelancerRows paging with tied sort values", () => {
  const SORTS = [
    "recommended",
    "rating",
    "success",
    "projects",
    "rate-low",
  ] as const;

  const seedTies = async (withEarning: boolean) => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      ids.push(
        await seedTalent({
          rate: 9_000_100,
          verified: true,
          status: "AVAILABLE",
          earning: withEarning
            ? { rating: "4.00", success: "80.00", completed: 5 }
            : null,
        }),
      );
    }
    return ids;
  };

  it.each(
    SORTS.flatMap((sort) => [[sort, true] as const, [sort, false] as const]),
  )(
    "pages every row exactly once for sort %s (earning rows: %s)",
    async (sort, withEarning) => {
      const seeded = await seedTies(withEarning);
      const criteria = { ...BAND, sort };
      const everything = await searchFreelancerRows(db, criteria, EVERYTHING);

      const paged: string[] = [];
      for (let offset = 0; offset < seeded.length; offset += 3) {
        const page = await searchFreelancerRows(db, criteria, {
          limit: 3,
          offset,
        });
        paged.push(...page.map((row) => row.authId));
      }

      expect(new Set(paged).size).toBe(paged.length);
      expect([...paged].sort()).toEqual([...seeded].sort());
      expect(paged).toEqual(everything.map((row) => row.authId));
    },
  );
});
