import { randomUUID } from "node:crypto";
import { count, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  freelancer_metadata,
  job_posts,
  proposals,
} from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { toJobPostResponse } from "@/modules/jobs/index.js";
import {
  getMatchedJobPosts,
  getMatchedJobPostsBySkills,
} from "@/modules/freelancer/services/freelancer.jobs.service.js";
import { jobFeedQuerySchema } from "@/modules/freelancer/schemas/freelancer.schema.js";
import { agencyJobFeedQuerySchema } from "@/modules/agency/schemas/agency.schema.js";
import type { JobFeedFilters } from "@/modules/freelancer/types/freelancer.types.js";

/*
 * Parity safety net for the job feed (freelancer feed and agency feed).
 *
 * The REFERENCE below is a self-contained copy of the pipeline that was in
 * production when this file was written: three whole-table queries, JS
 * filtering, JS scoring, JS sorting and JS slicing. It imports none of the
 * production feed functions, so it keeps working after they are removed. The
 * test compares it with the production entry points over a matrix of callers,
 * filters and pages, against a fixture that targets every edge of the pipeline.
 *
 * The test reads the whole published-jobs table, so it runs in the serial
 * payout-totals project.
 */

const PREFIX = "feed-parity-";
const like = `${PREFIX}%`;

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

interface Page {
  limit: number;
  offset: number;
}

type Filters = JobFeedFilters & { sort: "best-match" | "recent" };

// ---------------------------------------------------------------------------
// Caller side: the filter object the controllers build from the query string.
// ---------------------------------------------------------------------------

const filtersFromQuery = (
  raw: Record<string, string>,
  schema:
    | typeof jobFeedQuerySchema
    | typeof agencyJobFeedQuerySchema = jobFeedQuerySchema,
): Filters => {
  const query = schema.parse(raw);
  const list = (value: unknown) =>
    typeof value === "string" ? value.split(",").filter(Boolean) : undefined;
  const number = (value: unknown) => {
    const parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    sort: query.filter === "recent" ? "recent" : "best-match",
    levels: list(query.levels),
    durations: list(query.durations),
    minBudgetCents: number(query.minBudgetCents),
    maxBudgetCents: number(query.maxBudgetCents),
    minProposals: number(query.minProposals),
    maxProposals: number(query.maxProposals),
    paymentVerified: query.paymentVerified === "true",
  };
};

// ---------------------------------------------------------------------------
// REFERENCE: copy of the pre-SQL pipeline. Do not "improve" it.
// ---------------------------------------------------------------------------

const referenceJobs = () =>
  db
    .select({
      job: job_posts,
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      clientCountry: client_metadata.country,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(eq(job_posts.status, "PUBLISHED"))
    .orderBy(desc(job_posts.published_at), desc(job_posts.id));

const referenceProposalCounts = () =>
  db
    .select({ jobId: proposals.job_id, count: count(proposals.id) })
    .from(proposals)
    .groupBy(proposals.job_id);

const referenceHireCounts = () =>
  db
    .select({ jobId: contracts.job_id, count: count(contracts.id) })
    .from(contracts)
    .where(inArray(contracts.status, ["ACTIVE", "COMPLETED"]))
    .groupBy(contracts.job_id);

const referenceNormalize = (skill: string) =>
  skill.toLowerCase().replace(/[^a-z0-9]/g, "");

const referenceCompareIdsDescending = (first: string, second: string) =>
  first < second ? 1 : first > second ? -1 : 0;

const referenceMatch = async (skillList: string[], filters: Filters) => {
  const skills = skillList.map(referenceNormalize);

  const jobs = await referenceJobs();
  const proposalCounts = await referenceProposalCounts();
  const hireCounts = await referenceHireCounts();

  const counts = new Map(
    proposalCounts.map((item) => [item.jobId, Number(item.count)]),
  );
  const hires = new Map(
    hireCounts.map((item) => [item.jobId, Number(item.count)]),
  );

  const filteredJobs = jobs
    .map(
      ({
        job,
        clientAccountId,
        companyName,
        clientCountry,
        paymentVerified,
        totalSpentCents,
        clientRating,
        clientReviewCount,
      }) => ({
        ...job,
        clientAccountId,
        companyName,
        clientCountry,
        paymentVerified: paymentVerified === true,
        proposalCount: counts.get(job.id) ?? 0,
        hireCount: hires.get(job.id) ?? 0,
        clientTotalSpentCents: totalSpentCents ?? 0,
        clientRating: Number(clientRating ?? 0),
        clientReviewCount: Number(clientReviewCount ?? 0),
      }),
    )
    .filter((job) => {
      const budgetCents = job.total_budget_cents;
      return (
        (!filters.levels?.length ||
          filters.levels.includes(job.expertise_level)) &&
        (!filters.durations?.length ||
          filters.durations.includes(job.expected_duration)) &&
        (filters.minBudgetCents === undefined ||
          budgetCents >= filters.minBudgetCents) &&
        (filters.maxBudgetCents === undefined ||
          budgetCents <= filters.maxBudgetCents) &&
        (filters.minProposals === undefined ||
          job.proposalCount >= filters.minProposals) &&
        (filters.maxProposals === undefined ||
          job.proposalCount <= filters.maxProposals) &&
        (!filters.paymentVerified || job.paymentVerified)
      );
    });

  if (filters.sort === "recent") return filteredJobs;

  return filteredJobs
    .map((job) => {
      const jobSkills = job.skills.map(referenceNormalize);
      const content = referenceNormalize(`${job.title} ${job.description}`);
      const skillMatches = skills.filter((skill) =>
        jobSkills.some(
          (jobSkill) => jobSkill === skill || jobSkill.includes(skill),
        ),
      ).length;
      const contentMatches = skills.filter((skill) =>
        content.includes(skill),
      ).length;

      return { ...job, matchScore: skillMatches * 2 + contentMatches };
    })
    .filter((job) => job.matchScore > 0)
    .sort(
      (first, second) =>
        second.matchScore - first.matchScore ||
        new Date(second.published_at ?? second.created_at ?? 0).getTime() -
          new Date(first.published_at ?? first.created_at ?? 0).getTime() ||
        referenceCompareIdsDescending(first.id, second.id),
    );
};

const scoreOf = (row: object) =>
  "matchScore" in row ? row.matchScore : undefined;

const referencePage = (
  matched: Awaited<ReturnType<typeof referenceMatch>>,
  { limit, offset }: Page,
  operation: string,
) => {
  const fetched = matched.slice(offset, offset + limit + 1);
  const rows = fetched.slice(0, limit);
  return {
    results: rows.map(({ clientAccountId, clientCountry, ...job }) => ({
      ...toJobPostResponse(job, clientAccountId, operation),
      clientCountry: clientCountry ?? null,
    })),
    hasMore: fetched.length > limit,
  };
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const jobId = (n: number) =>
  `f00d0000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const at = (second: number, micro = 0) =>
  `2024-06-01 10:00:${String(second).padStart(2, "0")}.${String(micro).padStart(6, "0")}+00`;

type ClientKey = "verified" | "unverified" | "unknown" | "noMetadata";

interface JobSpec {
  n: number;
  client: ClientKey;
  title: string;
  description: string;
  level: string;
  duration: string;
  budget: number;
  skills: string[];
  status?: string;
  published: string | null;
  created?: string | null;
}

const JOBS: JobSpec[] = [
  {
    n: 0x01,
    client: "verified",
    title: "Dashboard build",
    description: "Charts and tables",
    level: "EXPERT",
    duration: "1 month",
    budget: 5000,
    skills: ["Next.js", "TypeScript"],
    published: at(5, 500000),
  },
  {
    n: 0x20,
    client: "verified",
    title: "Mobile client",
    description: "App",
    level: "INTERMEDIATE",
    duration: "3 months",
    budget: 10000,
    skills: ["React Native"],
    published: at(4, 123100),
  },
  {
    n: 0x03,
    client: "verified",
    title: "Other",
    description: "x",
    level: "INTERMEDIATE",
    duration: "3 months",
    budget: 10000,
    skills: ["React"],
    published: at(4, 123900),
  },
  {
    n: 0x04,
    client: "unverified",
    title: "Reactive design system",
    description: "figma",
    level: "ENTRY",
    duration: "1 week",
    budget: 0,
    skills: [],
    published: at(3),
  },
  {
    n: 0x05,
    client: "unverified",
    title: "Backend Rea",
    description: "ct developer needed",
    level: "EXPERT",
    duration: "1 month",
    budget: 7500,
    skills: ["Go"],
    published: at(2),
  },
  {
    n: 0x06,
    client: "unknown",
    title: "Legacy",
    description: "Python scripting",
    level: "expert",
    duration: "2 weeks",
    budget: 2500,
    skills: ["python"],
    published: null,
    created: at(1, 500000),
  },
  {
    n: 0x07,
    client: "unknown",
    title: "Undated",
    description: "Whenever python",
    level: "ENTRY",
    duration: "2 weeks",
    budget: 5001,
    skills: ["Python", "react"],
    published: null,
    created: null,
  },
  {
    n: 0x08,
    client: "verified",
    title: "Services",
    description: "Backend",
    level: "EXPERT",
    duration: "6 months",
    budget: 4999,
    skills: ["TYPE-script", "node_JS"],
    published: at(6),
  },
  {
    n: 0x09,
    client: "verified",
    title: "Draft react job",
    description: "react",
    level: "EXPERT",
    duration: "1 month",
    budget: 5000,
    skills: ["React"],
    status: "DRAFT",
    published: at(7),
  },
  {
    n: 0x0a,
    client: "verified",
    title: "Hired react job",
    description: "react",
    level: "EXPERT",
    duration: "1 month",
    budget: 5000,
    skills: ["React"],
    status: "HIRED",
    published: at(7),
  },
  {
    n: 0x0b,
    client: "noMetadata",
    title: "Orphan react job",
    description: "react",
    level: "EXPERT",
    duration: "1 month",
    budget: 5000,
    skills: ["React"],
    published: at(8),
  },
  {
    n: 0x42,
    client: "verified",
    title: "Tie job",
    description: "t",
    level: "EXPERT",
    duration: "1 month",
    budget: 5000,
    skills: ["React"],
    published: at(9),
  },
  {
    n: 0x40,
    client: "unverified",
    title: "Tie job",
    description: "t",
    level: "ENTRY",
    duration: "1 week",
    budget: 9999,
    skills: ["React"],
    published: at(9),
  },
  {
    n: 0x41,
    client: "unknown",
    title: "Tie job",
    description: "t",
    level: "INTERMEDIATE",
    duration: "3 months",
    budget: 7500,
    skills: ["React"],
    published: at(9),
  },
  {
    n: 0x0f,
    client: "verified",
    title: "Two skills",
    description: "web",
    level: "EXPERT",
    duration: "6 months",
    budget: 20000,
    skills: ["react", "NextJS"],
    published: at(9, 999999),
  },
  {
    n: 0x10,
    client: "unverified",
    title: "Plain",
    description: "nothing",
    level: "ENTRY",
    duration: "1 week",
    budget: 100,
    skills: [],
    published: at(10),
  },
  {
    n: 0x11,
    client: "verified",
    title: "Blank",
    description: "",
    level: "INTERMEDIATE",
    duration: "1 month",
    budget: 5000,
    skills: [],
    published: at(11),
  },
  {
    n: 0x12,
    client: "verified",
    title: "Unicode",
    description: "Ünïcode",
    level: "ENTRY",
    duration: "1 week",
    budget: 3000,
    skills: ["C++", "C#", "Café", "İstanbul"],
    published: at(12),
  },
  {
    n: 0x13,
    client: "unverified",
    title: "Odd values",
    description: "unknown level and a padded duration",
    level: "LEAD",
    duration: " 1 month",
    budget: 5000,
    skills: ["Rust"],
    published: at(13),
  },
  {
    n: 0x14,
    client: "unknown",
    title: "Empty values",
    description: "empty level and duration",
    level: "",
    duration: "",
    budget: 0,
    skills: [],
    published: at(14),
  },
];

const CLIENTS: Record<
  ClientKey,
  {
    verified: boolean | null;
    metadata: { country: string | null } | null;
    spent: { total: number; rating: string; reviews: number } | null;
  }
> = {
  verified: {
    verified: true,
    metadata: { country: "US" },
    spent: { total: 5000, rating: "4.50", reviews: 4 },
  },
  unverified: { verified: false, metadata: { country: null }, spent: null },
  unknown: {
    verified: null,
    metadata: { country: "DE" },
    spent: { total: 0, rating: "3.00", reviews: 0 },
  },
  noMetadata: { verified: true, metadata: null, spent: null },
};

const CALLERS = {
  multi: ["Next Js", "React", "TypeScript", "react"],
  react: ["React"],
  nextjs: ["Next Js"],
  python: ["Python", "Node JS"],
  emptyNormalized: ["+++", "React"],
  fragment: ["Rea", "Dashboard"],
  unicode: ["Café", "İstanbul"],
  empty: [] as string[],
};
type CallerKey = keyof typeof CALLERS;

type ProposalStatus = "SUBMITTED" | "VIEWED" | "INTERVIEWED" | "HIRED";

const callerAuthIds = new Map<CallerKey, string>();
const fixtureJobIds = new Set<string>();

const insertAccount = async (
  role: "CLIENT" | "FREELANCER",
  paymentMethodVerified: boolean | null = false,
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

const seedFixture = async () => {
  const clientAuth = new Map<ClientKey, string>();
  for (const [key, spec] of Object.entries(CLIENTS) as Array<
    [ClientKey, (typeof CLIENTS)[ClientKey]]
  >) {
    const authId = await insertAccount("CLIENT", spec.verified);
    clientAuth.set(key, authId);
    if (spec.metadata) {
      await db.insert(client_metadata).values({
        auth_id: authId,
        role: "CLIENT",
        company_name: `Parity ${key}`,
        company_website: "https://parity.example.test",
        company_size: "1-10",
        industry: "Software",
        company_description: "parity client",
        country: spec.metadata.country,
      });
    }
    if (spec.spent) {
      await db.insert(client_spents).values({
        client_id: authId,
        total_spent_cents: spec.spent.total,
        review_count: spec.spent.reviews,
        rating: spec.spent.rating,
      });
    }
  }

  for (const spec of JOBS) {
    const id = jobId(spec.n);
    fixtureJobIds.add(id);
    await pool.query(
      `insert into job_posts (id, client_id, title, description, expertise_level,
         expected_duration, skills, total_budget_cents, milestones, status,
         published_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9,
         $10::timestamptz, $11::timestamptz)`,
      [
        id,
        clientAuth.get(spec.client),
        spec.title,
        spec.description,
        spec.level,
        spec.duration,
        spec.skills,
        spec.budget,
        spec.status ?? "PUBLISHED",
        spec.published,
        spec.created === undefined ? at(0) : spec.created,
      ],
    );
  }

  const senders: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    senders.push(await insertAccount("FREELANCER"));
  }

  const addProposal = async (
    n: number,
    sender: number,
    status: ProposalStatus,
  ) => {
    const [row] = await db
      .insert(proposals)
      .values({
        job_id: jobId(n),
        sender_id: senders[sender]!,
        sender_type: "FREELANCER",
        cover_letter: "parity proposal",
        bid_amount_cents: 1000,
        duration: "1 week",
        status,
      })
      .returning({ id: proposals.id });
    return row!.id;
  };

  const clientOf = (n: number) =>
    clientAuth.get(JOBS.find((spec) => spec.n === n)!.client)!;

  const addContract = async (
    n: number,
    proposalId: string,
    sender: number,
    status: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED",
  ) => {
    await db.insert(contracts).values({
      proposal_id: proposalId,
      job_id: jobId(n),
      client_id: clientOf(n),
      freelancer_id: senders[sender]!,
      title: `${PREFIX}contract`,
      total_amount_cents: 1000,
      status,
    });
  };

  // 0x20: one proposal, a PENDING contract only: 1 proposal, 0 hires.
  const p20 = await addProposal(0x20, 0, "SUBMITTED");
  await addContract(0x20, p20, 0, "PENDING");

  // 0x03: a cancelled contract plus an active one: 2 proposals, 1 hire.
  const p03a = await addProposal(0x03, 0, "SUBMITTED");
  const p03b = await addProposal(0x03, 1, "VIEWED");
  await addContract(0x03, p03a, 0, "CANCELLED");
  await addContract(0x03, p03b, 1, "ACTIVE");

  // 0x04: completed, active and pending contracts: 3 proposals, 2 hires.
  const p04a = await addProposal(0x04, 0, "SUBMITTED");
  const p04b = await addProposal(0x04, 1, "VIEWED");
  const p04c = await addProposal(0x04, 2, "INTERVIEWED");
  await addContract(0x04, p04a, 0, "COMPLETED");
  await addContract(0x04, p04b, 1, "ACTIVE");
  await addContract(0x04, p04c, 2, "PENDING");

  // 0x05: every proposal status: 4 proposals, one cancelled contract only.
  const p05a = await addProposal(0x05, 0, "SUBMITTED");
  await addProposal(0x05, 1, "VIEWED");
  await addProposal(0x05, 2, "INTERVIEWED");
  await addProposal(0x05, 3, "HIRED");
  await addContract(0x05, p05a, 0, "CANCELLED");

  // 0x08: two proposals, no contracts.
  await addProposal(0x08, 0, "SUBMITTED");
  await addProposal(0x08, 1, "SUBMITTED");

  // 0x42: one proposal; 0x40: three proposals; 0x41: none.
  await addProposal(0x42, 0, "SUBMITTED");
  await addProposal(0x40, 0, "SUBMITTED");
  await addProposal(0x40, 1, "SUBMITTED");
  await addProposal(0x40, 2, "VIEWED");

  // a HIRED job still carries its proposal and an active contract
  const p0a = await addProposal(0x0a, 0, "HIRED");
  await addContract(0x0a, p0a, 0, "ACTIVE");

  for (const key of Object.keys(CALLERS) as CallerKey[]) {
    const authId = await insertAccount("FREELANCER");
    await db.insert(freelancer_metadata).values({
      auth_id: authId,
      professional_title: "Parity developer",
      professional_description: "parity",
      hourly_rate_cents: 5_000,
      country: "US",
      city: "Austin",
      weekly_availability: "30+ hours",
      experience_level: "INTERMEDIATE",
      skills: CALLERS[key],
      languages: [{ language: "English", proficiency: "Fluent" }],
    });
    callerAuthIds.set(key, authId);
  }
};

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

const FILTERS: Array<[string, Record<string, string>]> = [
  ["no filters", {}],
  ["levels EXPERT", { levels: "EXPERT" }],
  ["levels lowercase (case mismatch)", { levels: "expert" }],
  ["levels two values", { levels: "EXPERT,ENTRY" }],
  ["levels unknown value", { levels: "UNKNOWN" }],
  ["levels empty string", { levels: "" }],
  ["levels only commas", { levels: ",," }],
  ["levels value only a job has", { levels: "LEAD" }],
  ["levels not trimmed", { levels: "EXPERT, ENTRY" }],
  ["durations one", { durations: "1 month" }],
  ["durations two", { durations: "1 month,3 months" }],
  ["durations case mismatch", { durations: "1 MONTH" }],
  ["durations not trimmed", { durations: " 1 month" }],
  ["budget min only", { minBudgetCents: "5000" }],
  ["budget min above a boundary", { minBudgetCents: "5001" }],
  ["budget max only", { maxBudgetCents: "5000" }],
  ["budget max below a boundary", { maxBudgetCents: "4999" }],
  ["budget range", { minBudgetCents: "2500", maxBudgetCents: "7500" }],
  ["budget min equals max", { minBudgetCents: "5000", maxBudgetCents: "5000" }],
  ["budget min 0", { minBudgetCents: "0" }],
  ["budget max 0", { maxBudgetCents: "0" }],
  ["budget min above max", { minBudgetCents: "9000", maxBudgetCents: "100" }],
  ["proposals min 0", { minProposals: "0" }],
  ["proposals min 1", { minProposals: "1" }],
  ["proposals max 0", { maxProposals: "0" }],
  ["proposals max 2", { maxProposals: "2" }],
  ["proposals range", { minProposals: "1", maxProposals: "3" }],
  ["proposals min equals max", { minProposals: "2", maxProposals: "2" }],
  ["proposals min 4", { minProposals: "4" }],
  ["proposals min huge", { minProposals: "9999999999" }],
  ["paymentVerified true", { paymentVerified: "true" }],
  ["paymentVerified false", { paymentVerified: "false" }],
  [
    "levels, budget and proposals",
    {
      levels: "EXPERT,INTERMEDIATE",
      minBudgetCents: "5000",
      maxProposals: "4",
    },
  ],
  [
    "durations, budget and paymentVerified",
    {
      durations: "1 month,3 months,6 months",
      maxBudgetCents: "10000",
      paymentVerified: "true",
    },
  ],
  [
    "everything",
    {
      levels: "EXPERT,ENTRY,INTERMEDIATE",
      durations: "1 month,1 week,3 months",
      minBudgetCents: "0",
      maxBudgetCents: "20000",
      minProposals: "0",
      maxProposals: "3",
      paymentVerified: "true",
    },
  ],
];

const REDUCED_FILTER_NAMES = new Set([
  "no filters",
  "levels EXPERT",
  "budget range",
  "proposals range",
  "paymentVerified true",
  "everything",
]);

const FULL_MATRIX_CALLERS: CallerKey[] = ["multi", "react", "empty"];
const ALL_CALLERS = Object.keys(CALLERS) as CallerKey[];

const pagesFor = (total: number): Page[] => {
  const clamp = (value: number) => Math.min(100, Math.max(1, value));
  const candidates: Page[] = [
    { limit: 100, offset: 0 },
    { limit: clamp(total), offset: 0 },
    { limit: clamp(total - 1), offset: 0 },
    { limit: clamp(total + 1), offset: 0 },
    { limit: 3, offset: 0 },
    { limit: 3, offset: 2 },
    { limit: 5, offset: Math.min(total, 10_000) },
    { limit: 20, offset: 10_000 },
  ];
  const seen = new Set<string>();
  return candidates.filter((page) => {
    const key = `${page.limit}:${page.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const compareFeeds = async (
  callerKey: CallerKey,
  query: Record<string, string>,
  context: string,
) => {
  const skills = CALLERS[callerKey];
  const filters = filtersFromQuery(query);
  expect(
    filtersFromQuery(query, agencyJobFeedQuerySchema),
    `${context} agency filters`,
  ).toEqual(filters);

  const matched = await referenceMatch(skills, filters);
  const pages = pagesFor(matched.length);

  for (const page of pages) {
    const label = `${context} limit=${page.limit} offset=${page.offset}`;
    const expected = referencePage(matched, page, "feed_parity");

    const freelancerFeed = await getMatchedJobPosts(
      callerAuthIds.get(callerKey)!,
      filters,
      page,
    );
    expect(
      freelancerFeed.results.map((row) => row.id),
      `${label} freelancer ids`,
    ).toEqual(expected.results.map((row) => row.id));
    expect(freelancerFeed.hasMore, `${label} freelancer hasMore`).toBe(
      expected.hasMore,
    );
    expect(freelancerFeed, `${label} freelancer feed`).toEqual(expected);

    const agencyFeed = await getMatchedJobPostsBySkills(
      skills,
      filters,
      page,
      "feed_parity",
    );
    expect(agencyFeed, `${label} agency feed`).toEqual(expected);
  }
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
  await seedFixture();
}, 60_000);

afterAll(async () => {
  await purge();
  await pool.end();
});

describe("job feed fixture", () => {
  const mine = (rows: Array<{ id: string }>) =>
    rows.filter((row) => fixtureJobIds.has(row.id)).map((row) => row.id);

  it("hits the edges the matrix relies on", async () => {
    const recent = await referenceMatch(
      [],
      filtersFromQuery({ filter: "recent" }),
    );
    const recentIds = mine(recent);
    for (const excluded of [0x09, 0x0a, 0x0b]) {
      expect(recentIds).not.toContain(jobId(excluded));
    }
    expect(recentIds).toHaveLength(17);
    expect(recentIds.indexOf(jobId(0x11))).toBeLessThan(
      recentIds.indexOf(jobId(0x10)),
    );
    // Postgres puts NULL published_at first under DESC, then id descending
    expect(recentIds.slice(0, 2)).toEqual([jobId(0x07), jobId(0x06)]);

    const byId = new Map(recent.map((row) => [row.id, row]));
    const counts = (n: number) => ({
      proposals: byId.get(jobId(n))?.proposalCount,
      hires: byId.get(jobId(n))?.hireCount,
    });
    expect(counts(0x20)).toEqual({ proposals: 1, hires: 0 });
    expect(counts(0x03)).toEqual({ proposals: 2, hires: 1 });
    expect(counts(0x04)).toEqual({ proposals: 3, hires: 2 });
    expect(counts(0x05)).toEqual({ proposals: 4, hires: 0 });
    expect(counts(0x01)).toEqual({ proposals: 0, hires: 0 });
    expect(byId.get(jobId(0x04))?.paymentVerified).toBe(false);
    expect(byId.get(jobId(0x06))?.paymentVerified).toBe(false);
    expect(byId.get(jobId(0x01))?.clientRating).toBe(4.5);
    expect(byId.get(jobId(0x10))?.clientTotalSpentCents).toBe(0);
    expect(byId.get(jobId(0x10))?.clientCountry).toBeNull();
  });

  it("holds timestamps that differ only in microseconds", async () => {
    const { rows } = await pool.query<{ micro: string }>(
      "select (extract(microseconds from published_at))::text as micro from job_posts where id = any($1) order by id",
      [[jobId(0x03), jobId(0x20)]],
    );
    expect(rows.map((row) => row.micro)).toEqual(["4123900", "4123100"]);

    const ranked = await referenceMatch(["React"], filtersFromQuery({}));
    const order = ranked.map((row) => row.id);
    expect(order.indexOf(jobId(0x20))).toBeLessThan(order.indexOf(jobId(0x03)));
  });

  it("orders ties by score, millisecond timestamp, then id descending", async () => {
    const ranked = await referenceMatch(["React"], filtersFromQuery({}));
    const ids = mine(ranked);
    const tied = [jobId(0x42), jobId(0x41), jobId(0x40)];
    const start = ids.indexOf(tied[0]!);
    expect(ids.slice(start, start + 3)).toEqual(tied);
    expect(scoreOf(ranked.find((row) => row.id === jobId(0x42))!)).toBe(2);
    expect(scoreOf(ranked.find((row) => row.id === jobId(0x04))!)).toBe(1);
    expect(scoreOf(ranked.find((row) => row.id === jobId(0x05))!)).toBe(1);
    expect(scoreOf(ranked.find((row) => row.id === jobId(0x20))!)).toBe(2);
  });

  it("scores duplicates and an empty normalized skill per entry", async () => {
    const multi = await referenceMatch(CALLERS.multi, filtersFromQuery({}));
    // 0x0f has skills react and NextJS: next js x1 skill, react x2 skill => 6
    // plus content matches none
    expect(scoreOf(multi.find((row) => row.id === jobId(0x0f))!)).toBe(6);

    const empty = await referenceMatch(
      CALLERS.emptyNormalized,
      filtersFromQuery({}),
    );
    // "+++" normalizes to "" and matches the content of every job (+1) and the
    // skills of every job that has at least one skill (+2); "react" adds none
    expect(scoreOf(empty.find((row) => row.id === jobId(0x10))!)).toBe(1);
    expect(scoreOf(empty.find((row) => row.id === jobId(0x01))!)).toBe(3);

    // non-ASCII letters are stripped, "İstanbul" lowercases to "i̇stanbul"
    const unicode = await referenceMatch(CALLERS.unicode, filtersFromQuery({}));
    expect(scoreOf(unicode.find((row) => row.id === jobId(0x12))!)).toBe(4);

    const none = await referenceMatch([], filtersFromQuery({}));
    expect(none).toEqual([]);
    const recentWithNone = await referenceMatch(
      [],
      filtersFromQuery({ filter: "recent" }),
    );
    expect(mine(recentWithNone).length).toBeGreaterThan(0);
  });
});

describe("job feed parity: SQL-bound pipeline equals the reference", () => {
  const cases: Array<[string, CallerKey, string, Record<string, string>]> = [];

  for (const callerKey of ALL_CALLERS) {
    for (const [name, query] of FILTERS) {
      if (
        !FULL_MATRIX_CALLERS.includes(callerKey) &&
        !REDUCED_FILTER_NAMES.has(name)
      ) {
        continue;
      }
      cases.push([
        `best-match / ${callerKey} / ${name}`,
        callerKey,
        name,
        query,
      ]);
    }
  }

  it.each(cases)("%s", async (_title, callerKey, name, query) => {
    await compareFeeds(
      callerKey,
      { ...query, filter: "best-match" },
      `best-match ${callerKey} ${name}`,
    );
  });

  const recentCases: Array<[string, CallerKey, Record<string, string>]> = [];
  for (const callerKey of ["multi", "empty"] as CallerKey[]) {
    for (const [name, query] of FILTERS) {
      recentCases.push([`recent / ${callerKey} / ${name}`, callerKey, query]);
    }
  }

  it.each(recentCases)("%s", async (_title, callerKey, query) => {
    await compareFeeds(
      callerKey,
      { ...query, filter: "recent" },
      `recent ${callerKey} ${JSON.stringify(query)}`,
    );
  });

  it("covers the matrix", () => {
    expect(cases.length + recentCases.length).toBeGreaterThanOrEqual(200);
  });
});
