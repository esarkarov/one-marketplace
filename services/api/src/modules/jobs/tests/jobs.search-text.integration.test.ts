import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../../infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: vi.fn(),
}));

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: {},
}));

vi.mock("../../../infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

import { db, pool } from "../../../database/client.js";
import {
  accounts,
  client_metadata,
  job_posts,
} from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { getPublicJobFeed } from "../services/jobs.service.js";

const PREFIX = "jobs-stext-it-";
const newToken = () => `tok${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from job_posts where client_id like $1", [like]);
  await pool.query("delete from client_metadata where auth_id like $1", [like]);
  await pool.query("delete from accounts where auth_id like $1", [like]);
};

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
  mocks.getUser.mockReset();
  mocks.getUser.mockImplementation(() => {
    throw new Error("Clerk must not be called on the public job feed");
  });
});

afterEach(() => {
  expect(mocks.getUser).not.toHaveBeenCalled();
});

const seed = async (options: {
  title: string;
  description?: string;
  skills?: string[];
  company?: string;
  status?: string;
  country?: string | null;
}) => {
  const clientId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: clientId,
    email: `${clientId}@example.test`,
    role: "CLIENT",
    paymentMethodVerified: true,
  });
  await db.insert(client_metadata).values({
    auth_id: clientId,
    role: "Founder",
    company_name: options.company ?? "Plain Company",
    company_website: "https://example.test",
    company_size: "1-10",
    industry: "Software",
    company_description: "x",
    country: options.country === undefined ? "DE" : options.country,
  });
  const [job] = await db
    .insert(job_posts)
    .values({
      client_id: clientId,
      title: options.title,
      description: options.description ?? "A job",
      expertise_level: "EXPERT",
      expected_duration: "1 month",
      skills: options.skills ?? [],
      total_budget_cents: 10000,
      milestones: [],
      status: options.status ?? "PUBLISHED",
      published_at: new Date(),
    })
    .returning({ id: job_posts.id });
  return job!.id;
};

const search = async (query: string, limit = 100, offset = 0) =>
  getPublicJobFeed({ query }, { limit, offset });

describe("getPublicJobFeed text query", () => {
  it("filters before the page so matches on later offsets are returned", async () => {
    const token = newToken();
    for (let index = 0; index < 5; index += 1) {
      await seed({ title: `${token} job ${index}` });
    }
    await seed({ title: "unrelated work" });

    const first = await search(token, 2, 0);
    const second = await search(token, 2, 2);
    const third = await search(token, 2, 4);

    expect(first.results).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(second.results).toHaveLength(2);
    expect(second.hasMore).toBe(true);
    expect(third.results).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    const ids = [first, second, third].flatMap((page) =>
      page.results.map((result) => result.id),
    );
    expect(new Set(ids).size).toBe(5);
  });

  it("is case-insensitive and matches non-adjacent words", async () => {
    const token = newToken();
    const id = await seed({
      title: `Build ${token} dashboard`,
      description: "with charts and exports",
    });

    for (const query of [
      token.toUpperCase(),
      `dashboard BUILD ${token}`,
      `${token} exports build`,
    ]) {
      expect((await search(query)).results.map((r) => r.id)).toEqual([id]);
    }
  });

  it("reaches title, description, skill and company name", async () => {
    const token = newToken();
    const id = await seed({
      title: `${token} Migration`,
      description: "Move the warehouse nightly",
      skills: ["Terraform", "Next.js"],
      company: "Wayne Enterprises",
    });
    await seed({ title: `${token} Other`, company: "Acme" });

    for (const term of [
      "migration",
      "warehouse",
      "terraform",
      "next.js",
      "wayne",
      "enterprises",
    ]) {
      const found = await search(`${token} ${term}`);
      expect(
        found.results.map((r) => r.id),
        term,
      ).toEqual([id]);
    }
  });

  it("only lists published jobs", async () => {
    const token = newToken();
    await seed({ title: `${token} draft`, status: "DRAFT" });

    expect((await search(token)).results).toHaveLength(0);
  });

  it("treats percent, underscore and backslash literally", async () => {
    const token = newToken();
    const percent = await seed({ title: `${token} 100% remote` });
    await seed({ title: `${token} 1000 remote` });
    const underscore = await seed({ title: `${token} snake_case` });
    await seed({ title: `${token} snakexcase` });
    const backslash = await seed({ title: String.raw`${token} dir\file` });
    await seed({ title: `${token} dirxfile` });

    const ids = async (term: string) =>
      (await search(`${token} ${term}`)).results.map((r) => r.id);
    expect(await ids("100%")).toEqual([percent]);
    expect(await ids("snake_case")).toEqual([underscore]);
    expect(await ids(String.raw`dir\file`)).toEqual([backslash]);
  });

  it("excludes non-matching rows and treats blank queries as no filter", async () => {
    const token = newToken();
    await seed({ title: `${token} alpha` });
    await seed({ title: `${token} beta` });

    expect((await search(`${token} gamma`)).results).toHaveLength(0);
    expect((await search(`${token} alpha beta`)).results).toHaveLength(0);

    for (const blank of ["", "   ", "\t \n"]) {
      const page = await search(blank, 1, 0);
      expect(page.results).toHaveLength(1);
      expect(page.hasMore).toBe(true);
    }
  });

  it("shows the stored client country without calling Clerk", async () => {
    const token = newToken();
    await seed({ title: `${token} located` });
    await seed({ title: `${token} elsewhere`, country: "JP" });

    const results = (await search(token)).results;

    expect(
      results.map((result) => [result.title, result.clientLocation]).sort(),
    ).toEqual([
      [`${token} elsewhere`, "Japan"],
      [`${token} located`, "Germany"],
    ]);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("shows no location for a client without a stored country", async () => {
    const token = newToken();
    await seed({ title: `${token} unlocated`, country: null });

    const [result] = (await search(token)).results;

    expect(result?.clientLocation).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
