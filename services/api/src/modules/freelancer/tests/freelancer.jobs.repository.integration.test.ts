import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/database/client.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  freelancer_metadata,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import {
  listBestMatchJobIds,
  listRecentJobIds,
  listFeedJobsByIds,
  type JobFeedSqlFilters,
} from "@/modules/freelancer/repositories/freelancer.jobs.repository.js";
import {
  getMatchedJobPosts,
  getMatchedJobPostsBySkills,
} from "@/modules/freelancer/services/freelancer.jobs.service.js";

/*
 * Every query here is narrowed to a budget band no other test file uses, so the
 * rows other files write never enter a page and the test runs in parallel.
 */

const PREFIX = "job-feed-repo-";
const like = `${PREFIX}%`;
const BAND_LOW = 8_100_000;
const BAND_HIGH = 8_100_999;
const BAND: JobFeedSqlFilters = {
  minBudgetCents: BAND_LOW,
  maxBudgetCents: BAND_HIGH,
};
const HUGE = 9_999_999_999;
const TIE_LOW = 8_101_000;
const TIE_BAND: JobFeedSqlFilters = {
  minBudgetCents: TIE_LOW,
  maxBudgetCents: TIE_LOW + 999,
};
const TIE_JOBS = Array.from({ length: 12 }, (_, index) => 101 + index);

const jobId = (n: number) =>
  `feed0000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const at = (second: number) =>
  `2024-07-01 10:00:${String(second).padStart(2, "0")}+00`;

interface JobSpec {
  n: number;
  client: "verified" | "unverified" | "noMetadata";
  level: string;
  status?: string;
  published: string | null;
}

// Published order, newest first, NULL first: 6, 5, 4, 3, 2, 1, 9. Jobs 3 and 4
// share a timestamp (id descending decides) and are inserted in ascending
// order so a missing tie-break shows. 7 is a draft; 8 has no client_metadata.
const JOBS: JobSpec[] = [
  { n: 1, client: "verified", level: "EXPERT", published: at(10) },
  { n: 2, client: "verified", level: "ENTRY", published: at(20) },
  { n: 3, client: "unverified", level: "EXPERT", published: at(30) },
  { n: 4, client: "verified", level: "EXPERT", published: at(30) },
  { n: 5, client: "verified", level: "EXPERT", published: at(40) },
  { n: 6, client: "verified", level: "EXPERT", published: null },
  {
    n: 7,
    client: "verified",
    level: "EXPERT",
    status: "DRAFT",
    published: at(45),
  },
  { n: 8, client: "noMetadata", level: "EXPERT", published: at(46) },
  { n: 9, client: "verified", level: "EXPERT", published: at(5) },
];
const EXPECTED_ORDER = [6, 5, 4, 3, 2, 1, 9].map(jobId);

const purge = async () => {
  await pool.query("delete from contracts where client_id like $1", [like]);
  await pool.query(
    "delete from proposals where job_id in (select id from job_posts where client_id like $1)",
    [like],
  );
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from client_spents where client_id like $1", [like]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  paymentMethodVerified: boolean,
) => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    paymentMethodVerified,
  });
  return authId;
};

let callerAuthId = "";

const seed = async () => {
  const clients = {
    verified: await insertAccount("CLIENT", true),
    unverified: await insertAccount("CLIENT", false),
    noMetadata: await insertAccount("CLIENT", true),
  };
  for (const key of ["verified", "unverified"] as const) {
    await db.insert(client_metadata).values({
      auth_id: clients[key],
      role: "CLIENT",
      company_name: `Feed repo ${key}`,
      company_website: "https://feed.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "feed repository test",
      country: "US",
    });
  }

  await db.insert(client_spents).values({
    client_id: clients.verified,
    total_spent_cents: 5_000,
    review_count: 4,
    rating: "4.50",
  });

  for (const spec of JOBS) {
    await pool.query(
      `insert into job_posts (id, client_id, title, description, expertise_level,
         expected_duration, skills, total_budget_cents, milestones, status,
         published_at, created_at)
       values ($1, $2, $3, $4, $5, '1 month', $6, $7, '[]'::jsonb, $8,
         $9::timestamptz, $10::timestamptz)`,
      [
        jobId(spec.n),
        clients[spec.client],
        `Feed repo job ${spec.n}`,
        "feed repository test",
        spec.level,
        ["React"],
        BAND_LOW + spec.n * 10,
        spec.status ?? "PUBLISHED",
        spec.published,
        at(0),
      ],
    );
  }

  // twelve jobs published in the same instant, inserted in ascending id order
  for (const n of TIE_JOBS) {
    await pool.query(
      `insert into job_posts (id, client_id, title, description, expertise_level,
         expected_duration, skills, total_budget_cents, milestones, status,
         published_at, created_at)
       values ($1, $2, $3, $4, 'EXPERT', '1 month', '{}', $5, '[]'::jsonb,
         'PUBLISHED', $6::timestamptz, $6::timestamptz)`,
      [
        jobId(n),
        clients.verified,
        `Feed repo tie ${n}`,
        "feed repository test",
        TIE_LOW + n,
        at(15),
      ],
    );
  }

  const senders: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    senders.push(await insertAccount("FREELANCER", false));
  }

  const addProposal = async (n: number, sender: number) => {
    const [row] = await db
      .insert(proposals)
      .values({
        job_id: jobId(n),
        sender_id: senders[sender]!,
        sender_type: "FREELANCER",
        cover_letter: "feed repository proposal",
        bid_amount_cents: 1000,
        duration: "1 week",
      })
      .returning({ id: proposals.id });
    return row!.id;
  };
  const addContract = async (
    n: number,
    proposalId: string,
    sender: number,
    status: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED",
  ) => {
    await db.insert(contracts).values({
      proposal_id: proposalId,
      job_id: jobId(n),
      client_id: clients.verified,
      freelancer_id: senders[sender]!,
      title: `${PREFIX}contract`,
      total_amount_cents: 1000,
      status,
    });
  };

  // job 1: three proposals, ACTIVE + COMPLETED + PENDING contracts: 3 and 2.
  await addContract(1, await addProposal(1, 0), 0, "ACTIVE");
  await addContract(1, await addProposal(1, 1), 1, "COMPLETED");
  await addContract(1, await addProposal(1, 2), 2, "PENDING");
  // job 2: one proposal with a CANCELLED contract: 1 and 0.
  await addContract(2, await addProposal(2, 0), 0, "CANCELLED");

  callerAuthId = await insertAccount("FREELANCER", false);
  await db.insert(freelancer_metadata).values({
    auth_id: callerAuthId,
    professional_title: "Feed repo developer",
    professional_description: "feed repository test",
    hourly_rate_cents: 5_000,
    country: "US",
    city: "Austin",
    weekly_availability: "30+ hours",
    experience_level: "INTERMEDIATE",
    skills: ["React"],
    languages: [{ language: "English", proficiency: "Fluent" }],
  });
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
  await seed();
}, 60_000);

afterAll(async () => {
  await purge();
  await pool.end();
});

const ids = (...numbers: number[]) => numbers.map(jobId);

const queryText = (config: unknown) => {
  if (typeof config === "string") return config;
  if (
    typeof config === "object" &&
    config !== null &&
    "text" in config &&
    typeof config.text === "string"
  ) {
    return config.text;
  }
  return "";
};

interface Captured {
  text: string;
  params: unknown[];
}

const capture = async <T>(run: () => Promise<T>) => {
  const spy = vi.spyOn(pool, "query");
  try {
    const result = await run();
    const statements: Captured[] = spy.mock.calls.map((call) => {
      const params: unknown = call[1];
      return {
        text: queryText(call[0]),
        params: Array.isArray(params) ? params : [],
      };
    });
    return { result, statements };
  } finally {
    spy.mockRestore();
  }
};

describe("listRecentJobIds", () => {
  it("returns the published jobs of the band, newest first with NULL first and id descending on ties", async () => {
    expect(await listRecentJobIds(db, BAND, { limit: 100, offset: 0 })).toEqual(
      EXPECTED_ORDER,
    );
  });

  it("breaks timestamp ties by id descending, with and without the index", async () => {
    const expected = [...TIE_JOBS].reverse().map(jobId);
    const page = { limit: 100, offset: 0 };
    expect(await listRecentJobIds(db, TIE_BAND, page)).toEqual(expected);

    const sorted = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_indexonlyscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      return listRecentJobIds(tx, TIE_BAND, page);
    });
    expect(sorted).toEqual(expected);
  });

  it("returns at most limit + 1 ids", async () => {
    for (const limit of [1, 2, 3, 6]) {
      const page = await listRecentJobIds(db, BAND, { limit, offset: 0 });
      expect(page).toEqual(EXPECTED_ORDER.slice(0, limit + 1));
      expect(page.length).toBeLessThanOrEqual(limit + 1);
    }
    expect(await listRecentJobIds(db, BAND, { limit: 7, offset: 0 })).toEqual(
      EXPECTED_ORDER,
    );
    expect(
      (await listRecentJobIds(db, BAND, { limit: 100, offset: 0 })).length,
    ).toBe(7);
  });

  it("applies the offset", async () => {
    expect(await listRecentJobIds(db, BAND, { limit: 3, offset: 2 })).toEqual(
      EXPECTED_ORDER.slice(2, 6),
    );
    expect(await listRecentJobIds(db, BAND, { limit: 3, offset: 5 })).toEqual(
      EXPECTED_ORDER.slice(5),
    );
  });

  it("returns an empty page when the offset is past the end", async () => {
    expect(await listRecentJobIds(db, BAND, { limit: 3, offset: 7 })).toEqual(
      [],
    );
    expect(
      await listRecentJobIds(db, BAND, { limit: 20, offset: 10_000 }),
    ).toEqual([]);
  });

  it("leaves out drafts and jobs whose client has no metadata", async () => {
    const all = await listRecentJobIds(db, BAND, { limit: 100, offset: 0 });
    expect(all).not.toContain(jobId(7));
    expect(all).not.toContain(jobId(8));
  });

  it("filters by level and duration", async () => {
    const page = { limit: 100, offset: 0 };
    expect(
      await listRecentJobIds(db, { ...BAND, levels: ["ENTRY"] }, page),
    ).toEqual(ids(2));
    expect(
      await listRecentJobIds(
        db,
        { ...BAND, levels: ["ENTRY", "EXPERT"] },
        page,
      ),
    ).toEqual(EXPECTED_ORDER);
    expect(await listRecentJobIds(db, { ...BAND, levels: [] }, page)).toEqual(
      EXPECTED_ORDER,
    );
    expect(
      await listRecentJobIds(db, { ...BAND, durations: ["1 month"] }, page),
    ).toEqual(EXPECTED_ORDER);
    expect(
      await listRecentJobIds(db, { ...BAND, durations: ["2 weeks"] }, page),
    ).toEqual([]);
  });

  it("filters budgets inclusively", async () => {
    const page = { limit: 100, offset: 0 };
    expect(
      await listRecentJobIds(
        db,
        { minBudgetCents: BAND_LOW + 20, maxBudgetCents: BAND_LOW + 20 },
        page,
      ),
    ).toEqual(ids(2));
    expect(
      await listRecentJobIds(
        db,
        { minBudgetCents: BAND_LOW + 20, maxBudgetCents: BAND_LOW + 40 },
        page,
      ),
    ).toEqual(ids(4, 3, 2));
  });

  it("filters on a verified payment method", async () => {
    expect(
      await listRecentJobIds(
        db,
        { ...BAND, paymentVerified: true },
        { limit: 100, offset: 0 },
      ),
    ).toEqual(ids(6, 5, 4, 2, 1, 9));
  });

  it("filters on the proposal count, with 10-digit values", async () => {
    const page = { limit: 100, offset: 0 };
    const run = (filters: JobFeedSqlFilters) =>
      listRecentJobIds(db, { ...BAND, ...filters }, page);

    expect(await run({ minProposals: 0 })).toEqual(EXPECTED_ORDER);
    expect(await run({ minProposals: 1 })).toEqual(ids(2, 1));
    expect(await run({ minProposals: 3 })).toEqual(ids(1));
    expect(await run({ minProposals: 4 })).toEqual([]);
    expect(await run({ maxProposals: 0 })).toEqual(ids(6, 5, 4, 3, 9));
    expect(await run({ minProposals: 1, maxProposals: 1 })).toEqual(ids(2));
    expect(await run({ minProposals: 1, maxProposals: 3 })).toEqual(ids(2, 1));
    expect(await run({ minProposals: HUGE })).toEqual([]);
    expect(await run({ maxProposals: HUGE })).toEqual(EXPECTED_ORDER);
    expect(await run({ minProposals: 2, maxProposals: 1 })).toEqual([]);
  });

  it("returns nothing when the filters exclude everything", async () => {
    const page = { limit: 20, offset: 0 };
    expect(
      await listRecentJobIds(db, { ...BAND, levels: ["NOPE"] }, page),
    ).toEqual([]);
    expect(
      await listRecentJobIds(
        db,
        { minBudgetCents: BAND_HIGH + 1, maxBudgetCents: BAND_HIGH + 2 },
        page,
      ),
    ).toEqual([]);
    expect(
      await listRecentJobIds(
        db,
        { ...BAND, minBudgetCents: BAND_HIGH, maxBudgetCents: BAND_LOW },
        page,
      ),
    ).toEqual([]);
  });
});

describe("listFeedJobsByIds", () => {
  it("returns exactly the requested ids, in newest-first order", async () => {
    const rows = await listFeedJobsByIds(db, ids(1, 4, 6));
    expect(rows.map((row) => row.job.id)).toEqual(ids(6, 4, 1));
  });

  it("counts proposals and hires per job as numbers", async () => {
    const rows = await listFeedJobsByIds(db, ids(1, 2, 4));
    const counts = new Map(
      rows.map((row) => [
        row.job.id,
        { proposals: row.proposalCount, hires: row.hireCount },
      ]),
    );
    expect(counts.get(jobId(1))).toEqual({ proposals: 3, hires: 2 });
    expect(counts.get(jobId(2))).toEqual({ proposals: 1, hires: 0 });
    expect(counts.get(jobId(4))).toEqual({ proposals: 0, hires: 0 });
    for (const row of rows) {
      expect(typeof row.proposalCount).toBe("number");
      expect(typeof row.hireCount).toBe("number");
    }
  });

  it("carries the client columns of the feed row", async () => {
    const [row] = await listFeedJobsByIds(db, ids(3));
    expect(row?.companyName).toBe("Feed repo unverified");
    expect(row?.clientCountry).toBe("US");
    expect(row?.paymentVerified).toBe(false);
    expect(row?.totalSpentCents).toBeNull();
  });

  it("carries the client spend, rating and review count of the feed row", async () => {
    const [row] = await listFeedJobsByIds(db, ids(1));
    expect(row).toMatchObject({
      companyName: "Feed repo verified",
      paymentVerified: true,
      totalSpentCents: 5_000,
      clientRating: "4.50",
      clientReviewCount: 4,
    });
  });

  it("returns nothing for no ids or ids that do not exist", async () => {
    expect(await listFeedJobsByIds(db, [])).toEqual([]);
    expect(await listFeedJobsByIds(db, [randomUUID()])).toEqual([]);
  });

  it("computes the counts only for the page rows", async () => {
    const pageIds = ids(1, 2, 4);
    const { result, statements } = await capture(() =>
      listFeedJobsByIds(db, pageIds),
    );
    expect(result).toHaveLength(pageIds.length);
    expect(statements).toHaveLength(1);

    const statement = statements[0]!;
    const { rows } = await pool.query<{ "QUERY PLAN": unknown }>(
      `explain (analyze, format json) ${statement.text}`,
      statement.params,
    );
    const nodes: Array<Record<string, unknown>> = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object" && node !== null) {
        nodes.push(Object.fromEntries(Object.entries(node)));
        Object.values(node).forEach(walk);
      }
    };
    walk(rows[0]?.["QUERY PLAN"]);

    for (const relation of ["proposals", "contracts"]) {
      const scans = nodes.filter((node) => node["Relation Name"] === relation);
      expect(scans.length, `${relation} is scanned`).toBeGreaterThan(0);
      for (const scan of scans) {
        expect(scan["Actual Loops"], `${relation} scan loops`).toBe(
          pageIds.length,
        );
      }
    }
  });
});

describe("recent feed query count", () => {
  const filters = { sort: "recent" as const, ...BAND };

  const expectBounded = (statements: Captured[]) => {
    for (const { text } of statements) {
      if (!/from "job_posts"/.test(text)) continue;
      const bounded =
        / limit \$\d+/.test(text) || /"job_posts"\."id" in \(/.test(text);
      expect(bounded, `unbounded job_posts select: ${text}`).toBe(true);
    }
  };

  it("issues the profile lookup and two feed queries for the freelancer feed", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPosts(callerAuthId, filters, { limit: 3, offset: 0 }),
    );
    expect(result.results.map((row) => row.id)).toEqual(ids(6, 5, 4));
    expect(result.hasMore).toBe(true);
    expect(statements).toHaveLength(3);
    expectBounded(statements);
  });

  it("issues two feed queries for the agency feed", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["React"],
        filters,
        { limit: 3, offset: 0 },
        "feed_repo",
      ),
    );
    expect(result.results).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(statements).toHaveLength(2);
    expectBounded(statements);
  });

  it("loads at most limit rows for the page, not limit + 1", async () => {
    const { statements } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["React"],
        filters,
        { limit: 3, offset: 0 },
        "feed_repo",
      ),
    );
    const rowsQuery = statements[1]!;
    const uuidParams = rowsQuery.params.filter(
      (param) => typeof param === "string" && param.startsWith("feed0000"),
    );
    expect(uuidParams).toHaveLength(3);
  });

  it("skips the second query for an empty page and reports no more", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["React"],
        filters,
        { limit: 3, offset: 50 },
        "feed_repo",
      ),
    );
    expect(result).toEqual({ results: [], hasMore: false });
    expect(statements).toHaveLength(1);
  });

  it("reports hasMore false on the last page", async () => {
    const { result } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["React"],
        filters,
        { limit: 3, offset: 5 },
        "feed_repo",
      ),
    );
    expect(result.results.map((row) => row.id)).toEqual(ids(1, 9));
    expect(result.hasMore).toBe(false);
  });
});

const BM_LOW = 8_102_000;
const BM_BAND: JobFeedSqlFilters = {
  minBudgetCents: BM_LOW,
  maxBudgetCents: BM_LOW + 999,
};
const bmId = (n: number) => jobId(n);
const bm = (...numbers: number[]) => numbers.map(bmId);
const bmAt = (second: number, micro = 0) =>
  `2024-08-01 10:00:${String(second).padStart(2, "0")}.${String(micro).padStart(6, "0")}+00`;

interface BestMatchSpec {
  n: number;
  title: string;
  description: string;
  skills: string[];
  published: string | null;
  created: string | null;
}

// Caller ["react"]. Scores: 203 spans skill and content (3); 201, 205, 206,
// 207, 208, 209, 210 match a skill only (2); 202 matches content only (1);
// 204 matches nothing; 299 is a draft.
const BEST_MATCH_JOBS: BestMatchSpec[] = [
  {
    n: 201,
    title: "Plain",
    description: "nothing",
    skills: ["React.js"],
    published: bmAt(30),
    created: bmAt(0),
  },
  {
    n: 202,
    title: "Reactive UI",
    description: "x",
    skills: [],
    published: bmAt(58),
    created: bmAt(0),
  },
  {
    n: 203,
    title: "React app",
    description: "z",
    skills: ["ReactNative"],
    published: bmAt(1),
    created: bmAt(0),
  },
  {
    n: 204,
    title: "Backend",
    description: "Go",
    skills: ["Go"],
    published: bmAt(59),
    created: bmAt(0),
  },
  {
    n: 205,
    title: "Plain",
    description: "nothing",
    skills: ["react"],
    published: bmAt(30),
    created: bmAt(0),
  },
  {
    n: 206,
    title: "Plain",
    description: "nothing",
    skills: ["R-E-A-C-T"],
    published: bmAt(40),
    created: bmAt(0),
  },
  {
    n: 207,
    title: "Plain",
    description: "nothing",
    skills: ["REACT"],
    published: null,
    created: bmAt(35),
  },
  {
    n: 208,
    title: "Plain",
    description: "nothing",
    skills: ["React"],
    published: null,
    created: null,
  },
  {
    n: 209,
    title: "Plain",
    description: "nothing",
    skills: ["React"],
    published: bmAt(50, 900),
    created: bmAt(0),
  },
  {
    n: 210,
    title: "Plain",
    description: "nothing",
    skills: ["React"],
    published: bmAt(50, 100),
    created: bmAt(0),
  },
];
const BEST_MATCH_ORDER = bm(203, 210, 209, 206, 207, 205, 201, 208, 202);

describe("listBestMatchJobIds", () => {
  const page = { limit: 100, offset: 0 };

  beforeAll(async () => {
    const authId = await insertAccount("CLIENT", true);
    await db.insert(client_metadata).values({
      auth_id: authId,
      role: "CLIENT",
      company_name: "Feed repo best match",
      company_website: "https://feed.example.test",
      company_size: "1-10",
      industry: "Software",
      company_description: "feed repository test",
      country: "US",
    });
    for (const spec of BEST_MATCH_JOBS) {
      await pool.query(
        `insert into job_posts (id, client_id, title, description, expertise_level,
           expected_duration, skills, total_budget_cents, milestones, status,
           published_at, created_at)
         values ($1, $2, $3, $4, 'EXPERT', '1 month', $5, $6, '[]'::jsonb,
           'PUBLISHED', $7::timestamptz, $8::timestamptz)`,
        [
          bmId(spec.n),
          authId,
          spec.title,
          spec.description,
          spec.skills,
          BM_LOW + spec.n,
          spec.published,
          spec.created,
        ],
      );
    }
    await pool.query(
      `insert into job_posts (id, client_id, title, description, expertise_level,
         expected_duration, skills, total_budget_cents, milestones, status)
       values ($1, $2, 'React draft', 'x', 'EXPERT', '1 month', '{React}', $3,
         '[]'::jsonb, 'DRAFT')`,
      [bmId(299), authId, BM_LOW + 299],
    );
  }, 60_000);

  const scores = async (skills: string[]) =>
    Object.fromEntries(
      (await listBestMatchJobIds(db, BM_BAND, skills, page)).map((row) => [
        row.id,
        row.score,
      ]),
    );

  it("ranks by score, then published time, then id descending", async () => {
    const rows = await listBestMatchJobIds(db, BM_BAND, ["react"], page);
    expect(rows.map((row) => row.id)).toEqual(BEST_MATCH_ORDER);
  });

  it("scores a skill match twice and a content match once", async () => {
    const result = await scores(["react"]);
    expect(result[bmId(203)]).toBe(3);
    expect(result[bmId(201)]).toBe(2);
    expect(result[bmId(202)]).toBe(1);
    expect(result[bmId(204)]).toBeUndefined();
    expect(result[bmId(299)]).toBeUndefined();
  });

  it("matches a job skill that contains the caller skill, not the reverse", async () => {
    expect((await scores(["reactnative"]))[bmId(203)]).toBe(2);
    expect(await scores(["reactnativeexpo"])).toEqual({});
  });

  it("counts a duplicated caller skill each time", async () => {
    const result = await scores(["react", "react"]);
    expect(result[bmId(203)]).toBe(6);
    expect(result[bmId(201)]).toBe(4);
    expect(result[bmId(202)]).toBe(2);
  });

  it("normalizes the job side with lower() and strips punctuation", async () => {
    const result = await scores(["react"]);
    expect(result[bmId(206)]).toBe(2);
    expect(result[bmId(207)]).toBe(2);
  });

  it("matches across the title and description boundary", async () => {
    expect(await scores(["plainnothing"])).toEqual({
      [bmId(201)]: 1,
      [bmId(205)]: 1,
      [bmId(206)]: 1,
      [bmId(207)]: 1,
      [bmId(208)]: 1,
      [bmId(209)]: 1,
      [bmId(210)]: 1,
    });
  });

  it("matches every job for an empty normalized skill", async () => {
    const result = await scores([""]);
    expect(Object.keys(result).sort()).toEqual(
      bm(201, 202, 203, 204, 205, 206, 207, 208, 209, 210).sort(),
    );
    expect(result[bmId(204)]).toBe(3);
    expect(result[bmId(202)]).toBe(1);
  });

  it("returns nothing for an empty skill list without running a query", async () => {
    const { result, statements } = await capture(() =>
      listBestMatchJobIds(db, BM_BAND, [], page),
    );
    expect(result).toEqual([]);
    expect(statements).toHaveLength(0);
  });

  it("does not normalize the caller skills itself", async () => {
    expect(await scores(["+++"])).toEqual({});
  });

  it("orders ties inside one millisecond by id, not by microseconds", async () => {
    const order = (await listBestMatchJobIds(db, BM_BAND, ["react"], page)).map(
      (row) => row.id,
    );
    expect(order.indexOf(bmId(210))).toBeLessThan(order.indexOf(bmId(209)));
  });

  it("falls back to created_at, then to the epoch, when published_at is null", async () => {
    const order = (await listBestMatchJobIds(db, BM_BAND, ["react"], page)).map(
      (row) => row.id,
    );
    expect(order.indexOf(bmId(207))).toBeGreaterThan(order.indexOf(bmId(206)));
    expect(order.indexOf(bmId(207))).toBeLessThan(order.indexOf(bmId(205)));
    expect(order.indexOf(bmId(208))).toBeGreaterThan(order.indexOf(bmId(201)));
  });

  it("returns at most limit + 1 ids and pages without gaps or repeats", async () => {
    for (const limit of [1, 2, 4]) {
      const rows = await listBestMatchJobIds(db, BM_BAND, ["react"], {
        limit,
        offset: 0,
      });
      expect(rows.map((row) => row.id)).toEqual(
        BEST_MATCH_ORDER.slice(0, limit + 1),
      );
    }
    const paged: string[] = [];
    for (let offset = 0; offset < 12; offset += 3) {
      const rows = await listBestMatchJobIds(db, BM_BAND, ["react"], {
        limit: 3,
        offset,
      });
      paged.push(...rows.slice(0, 3).map((row) => row.id));
    }
    expect(paged).toEqual(BEST_MATCH_ORDER);
  });

  it("returns nothing for a large offset", async () => {
    expect(
      await listBestMatchJobIds(db, BM_BAND, ["react"], {
        limit: 20,
        offset: 10_000,
      }),
    ).toEqual([]);
  });

  it("applies the shared feed filters", async () => {
    expect(
      await listBestMatchJobIds(
        db,
        { ...BM_BAND, levels: ["ENTRY"] },
        ["react"],
        page,
      ),
    ).toEqual([]);
    expect(
      await listBestMatchJobIds(
        db,
        { ...BM_BAND, paymentVerified: true, durations: ["1 month"] },
        ["react"],
        page,
      ),
    ).toHaveLength(BEST_MATCH_ORDER.length);
  });
});

describe("best-match feed query count", () => {
  const filters = { sort: "best-match" as const, ...BM_BAND };
  const first = { limit: 3, offset: 0 };

  const expectBounded = (statements: Captured[]) => {
    for (const { text } of statements) {
      if (!/from "job_posts"/.test(text)) continue;
      const bounded =
        / limit \$\d+/.test(text) || /"job_posts"\."id" in \(/.test(text);
      expect(bounded, `unbounded job_posts select: ${text}`).toBe(true);
    }
  };

  it("issues the profile lookup and two feed queries for the freelancer feed", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPosts(callerAuthId, filters, first),
    );
    expect(result.results.map((row) => row.id)).toEqual(bm(203, 210, 209));
    expect(
      result.results.map((row) => ("matchScore" in row ? row.matchScore : -1)),
    ).toEqual([3, 2, 2]);
    expect(result.hasMore).toBe(true);
    expect(statements).toHaveLength(3);
    expectBounded(statements);
  });

  it("issues two feed queries for the agency feed", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPostsBySkills(["React"], filters, first, "feed_repo"),
    );
    expect(result.results).toHaveLength(3);
    expect(statements).toHaveLength(2);
    expectBounded(statements);
  });

  it("skips the second query for an empty page and reports no more", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["React"],
        filters,
        { limit: 3, offset: 50 },
        "feed_repo",
      ),
    );
    expect(result).toEqual({ results: [], hasMore: false });
    expect(statements).toHaveLength(1);
  });

  it("answers an empty feed without a feed query when the skills are empty", async () => {
    const { result, statements } = await capture(() =>
      getMatchedJobPostsBySkills([], filters, first, "feed_repo"),
    );
    expect(result).toEqual({ results: [], hasMore: false });
    expect(statements).toHaveLength(0);
  });

  it("matches every job for a skill that normalizes to an empty string", async () => {
    const { result } = await capture(() =>
      getMatchedJobPostsBySkills(
        ["+++"],
        filters,
        { limit: 100, offset: 0 },
        "feed_repo",
      ),
    );
    expect(result.results).toHaveLength(BEST_MATCH_ORDER.length + 1);
  });

  it("puts matchScore on best-match rows only", async () => {
    const recent = await getMatchedJobPostsBySkills(
      ["React"],
      { sort: "recent", ...BM_BAND },
      first,
      "feed_repo",
    );
    expect(recent.results.length).toBeGreaterThan(0);
    for (const row of recent.results) expect("matchScore" in row).toBe(false);
  });
});
