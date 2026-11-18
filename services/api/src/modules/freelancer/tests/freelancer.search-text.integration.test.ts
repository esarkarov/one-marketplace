import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  upload: vi.fn(),
}));

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../config/env.js")>();
  return {
    ...original,
    env: {
      ...original.env,
      clerkSecretKey: "sk_test",
      imageKitPrivateKey: "ik_test",
    },
  };
});

vi.mock("../../../infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: vi.fn(),
}));

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: {},
}));

vi.mock("../../../infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: vi.fn() } },
}));

vi.mock("../../../infrastructure/cache/account-auth.cache.js", () => ({
  invalidateAccountAuthCache: async () => undefined,
}));

import { env } from "../../../config/env.js";
import { db, pool } from "../../../database/client.js";
import { accounts, freelancer_metadata } from "../../../test/support/tables.js";
import { buildFreelancerSearchFields } from "../utils/freelancer.search-text.js";
import { searchPublicFreelancers } from "../services/freelancer.search.service.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  getPublicFreelancerProfile,
  saveFreelancerProfile,
} from "../services/freelancer.profile.service.js";
import {
  listFreelancerAuthIds,
  rebuildFreelancerSearchText,
} from "../services/freelancer.search-index.service.js";

const PREFIX = "freelancer-stext-it-";
const newAuthId = () => `${PREFIX}${randomUUID()}`;

const clerkUser = {
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: "Ada Lovelace",
  imageUrl: "https://img.test/ada.png",
};

const insertAccount = async (
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
    ...extra,
  });
  return authId;
};

const profileInput = (userId: string, country = "DE") => ({
  userId,
  professional_title: "Backend  Developer",
  professional_description: "I build APIs.",
  hourly_rate_cents: 6000,
  country,
  city: "Berlin",
  availability_status: "AVAILABLE",
  weekly_availability: "30",
  experience_level: "EXPERT",
  skills: ["Node", "PostgreSQL"],
  languages: [{ language: "English", proficiency: "Fluent" }],
  portfolios: [
    {
      title: "Shop",
      category: "Web",
      description: "A shop.",
      live_url: null,
      cover_image: { url: "data:image/png;base64,iVBORw0KGgo=" },
    },
  ],
});

const metadataOf = async (authId: string) => {
  const [row] = await db
    .select()
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.auth_id, authId));
  return row;
};

const accountOf = async (authId: string) => {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.auth_id, authId));
  return row;
};

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from freelancer_metadata where auth_id like $1", [
    like,
  ]);
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
  mocks.getUser.mockResolvedValue(clerkUser);
  mocks.upload.mockReset();
  mocks.upload.mockImplementation(async () => ({
    fileId: `file_${randomUUID()}`,
    url: "https://ik.example.test/cover.png",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveFreelancerProfile search columns", () => {
  it("writes search_text and location_text with the English country name", async () => {
    const authId = await insertAccount();

    await saveFreelancerProfile(profileInput(authId), true);

    const row = await metadataOf(authId);
    expect(row?.search_text).toBe(
      "ada lovelace backend developer berlin germany node postgresql",
    );
    expect(row?.location_text).toBe("berlin germany");
    const account = await accountOf(authId);
    expect(account?.display_name).toBe("Ada Lovelace");
    expect(account?.avatar_url).toBe("https://img.test/ada.png");
  });

  it("rewrites the columns when the profile changes", async () => {
    const authId = await insertAccount();
    await saveFreelancerProfile(profileInput(authId, "DE"), true);

    await saveFreelancerProfile(profileInput(authId, "FR"), true);

    const row = await metadataOf(authId);
    expect(row?.location_text).toBe("berlin france");
    expect(row?.search_text).not.toContain("germany");
  });

  it("calls Clerk before the transaction and never inside it", async () => {
    const authId = await insertAccount();
    const events: string[] = [];
    let insideTransaction = false;
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(((
      callback: never,
      config?: never,
    ) => {
      events.push("tx:start");
      insideTransaction = true;
      return transaction(callback, config).finally(() => {
        insideTransaction = false;
        events.push("tx:end");
      });
    }) as never);
    mocks.getUser.mockImplementation(async () => {
      events.push(insideTransaction ? "clerk:inside-tx" : "clerk");
      return clerkUser;
    });

    await saveFreelancerProfile(profileInput(authId), true);

    expect(events).toEqual(["clerk", "tx:start", "tx:end"]);
  });

  it("still saves the profile and keeps the stored name when Clerk fails", async () => {
    const authId = await insertAccount({
      display_name: "Stored Name",
      avatar_url: "https://img.test/stored.png",
    });
    mocks.getUser.mockRejectedValue(new Error("clerk down"));

    await saveFreelancerProfile(profileInput(authId), true);

    const row = await metadataOf(authId);
    expect(row?.search_text).toBe(
      "stored name backend developer berlin germany node postgresql",
    );
    const account = await accountOf(authId);
    expect(account?.display_name).toBe("Stored Name");
    expect(account?.avatar_url).toBe("https://img.test/stored.png");
  });

  it("saves with no name when Clerk fails and nothing is stored", async () => {
    const authId = await insertAccount();
    mocks.getUser.mockRejectedValue(new Error("clerk down"));

    await saveFreelancerProfile(profileInput(authId), true);

    expect((await metadataOf(authId))?.search_text).toBe(
      "backend developer berlin germany node postgresql",
    );
  });
});

describe("rebuildFreelancerSearchText", () => {
  it("rebuilds from stored data, is idempotent and honours dry run", async () => {
    const authId = await insertAccount({ display_name: "Grace Hopper" });
    await db.insert(freelancer_metadata).values({
      auth_id: authId,
      professional_title: "Compiler Engineer",
      professional_description: "x",
      hourly_rate_cents: 1000,
      country: "US",
      city: "New York",
      weekly_availability: "10",
      experience_level: "EXPERT",
      skills: ["COBOL"],
      languages: [],
    });

    await expect(
      rebuildFreelancerSearchText(authId, { dryRun: true }),
    ).resolves.toBe(true);
    expect((await metadataOf(authId))?.search_text).toBe("");

    await expect(rebuildFreelancerSearchText(authId)).resolves.toBe(true);
    const row = await metadataOf(authId);
    expect(row?.search_text).toBe(
      "grace hopper compiler engineer new york united states cobol",
    );
    expect(row?.location_text).toBe("new york united states");

    await expect(rebuildFreelancerSearchText(authId)).resolves.toBe(false);
    await expect(rebuildFreelancerSearchText("missing-id")).resolves.toBe(
      false,
    );
    expect(await listFreelancerAuthIds()).toContain(authId);
  });
});

describe("searchPublicFreelancers text query", () => {
  const newToken = () => `tok${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const seed = async (options: {
    title: string;
    skills?: string[];
    city?: string;
    country?: string;
    name?: string | null;
    avatar?: string | null;
  }) => {
    const name = options.name ?? null;
    const authId = await insertAccount({
      display_name: name,
      avatar_url: options.avatar ?? null,
    });
    const [row] = await db
      .insert(freelancer_metadata)
      .values({
        auth_id: authId,
        professional_title: options.title,
        professional_description: "x",
        hourly_rate_cents: 1000,
        country: options.country ?? "DE",
        city: options.city ?? "Berlin",
        weekly_availability: "10",
        experience_level: "EXPERT",
        skills: options.skills ?? [],
        languages: [],
        ...buildFreelancerSearchFields({
          displayName: name,
          professionalTitle: options.title,
          city: options.city ?? "Berlin",
          country: options.country ?? "DE",
          skills: options.skills ?? [],
        }),
      })
      .returning({ id: freelancer_metadata.id });
    return row!.id;
  };

  const search = async (query: string, limit = 100, offset = 0) =>
    searchPublicFreelancers({ query }, { limit, offset });

  it("returns the stored name and avatar with the existing placeholders, without calling Clerk", async () => {
    const token = newToken();
    const named = await seed({
      title: `${token} named`,
      name: "Stored Person",
      avatar: "https://img.test/stored.png",
    });
    const bare = await seed({ title: `${token} bare` });

    const byId = new Map(
      (await search(token)).results.map((result) => [result.id, result]),
    );

    expect(byId.get(named)).toMatchObject({
      name: "Stored Person",
      avatarUrl: "https://img.test/stored.png",
    });
    expect(byId.get(bare)).toMatchObject({
      name: "Freelancer",
      avatarUrl: null,
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not depend on the Clerk key being configured", async () => {
    const token = newToken();
    const id = await seed({ title: `${token} keyless`, name: "Keyless Kim" });
    const configured = env.clerkSecretKey;
    Object.assign(env, { clerkSecretKey: undefined });
    try {
      const found = (await search(token)).results;
      expect(found.map((result) => [result.id, result.name])).toEqual([
        [id, "Keyless Kim"],
      ]);
    } finally {
      Object.assign(env, { clerkSecretKey: configured });
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("filters before the page so matches on later offsets are returned", async () => {
    const token = newToken();
    for (let index = 0; index < 5; index += 1) {
      await seed({ title: `${token} developer ${index}` });
    }
    await seed({ title: "unrelated designer" });

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
    const id = await seed({ title: `Senior ${token} Backend Developer` });

    for (const query of [
      token.toUpperCase(),
      `developer SENIOR ${token}`,
      `  senior   developer  `,
    ]) {
      const found = (await search(`${query} ${token}`)).results;
      expect(found.map((result) => result.id)).toEqual([id]);
    }
  });

  it("reaches name, title, skill, city and country name", async () => {
    const token = newToken();
    const id = await seed({
      title: `${token} Engineer`,
      skills: ["Rust", "WebAssembly"],
      city: "Lisbon",
      country: "PT",
      name: "Quincy Zephyr",
    });
    await seed({ title: `${token} Designer`, city: "Oslo", country: "NO" });

    for (const term of [
      "quincy",
      "zephyr",
      "engineer",
      "rust",
      "webassembly",
      "lisbon",
      "portugal",
    ]) {
      const found = (await search(`${token} ${term}`)).results;
      expect(
        found.map((result) => result.id),
        term,
      ).toEqual([id]);
    }
    expect((await search(`${token} norway`)).results).toHaveLength(1);
  });

  it("treats percent, underscore and backslash literally", async () => {
    const token = newToken();
    const percent = await seed({ title: `${token} 100% sure` });
    await seed({ title: `${token} 1000 sure` });
    const underscore = await seed({ title: `${token} snake_case` });
    await seed({ title: `${token} snakexcase` });
    const backslash = await seed({ title: String.raw`${token} dir\file` });
    await seed({ title: `${token} dirxfile` });

    const ids = async (term: string) =>
      (await search(`${token} ${term}`)).results.map((result) => result.id);
    expect(await ids("100%")).toEqual([percent]);
    expect(await ids("snake_case")).toEqual([underscore]);
    expect(await ids(String.raw`dir\file`)).toEqual([backslash]);
    expect((await search(`${token} %`)).results.length).toBe(1);
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
});

describe("getPublicFreelancerProfile display data", () => {
  const seedProfile = async (display: {
    display_name: string | null;
    avatar_url: string | null;
  }) => {
    const authId = await insertAccount(display);
    const [row] = await db
      .insert(freelancer_metadata)
      .values({
        auth_id: authId,
        professional_title: "Engineer",
        professional_description: "x",
        hourly_rate_cents: 1000,
        country: "DE",
        city: "Berlin",
        weekly_availability: "10",
        experience_level: "EXPERT",
        skills: [],
        languages: [],
      })
      .returning({ id: freelancer_metadata.id });
    return row!.id;
  };

  it("returns the stored name and avatar without calling Clerk", async () => {
    const id = await seedProfile({
      display_name: "Stored Person",
      avatar_url: "https://img.test/stored.png",
    });
    mocks.getUser.mockRejectedValue(new Error("clerk down"));

    const profile = await getPublicFreelancerProfile(id);

    expect(profile).toMatchObject({
      id,
      name: "Stored Person",
      avatarUrl: "https://img.test/stored.png",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("falls back to the placeholder name and no avatar when nothing is stored", async () => {
    const id = await seedProfile({ display_name: null, avatar_url: null });

    const profile = await getPublicFreelancerProfile(id);

    expect(profile).toMatchObject({ id, name: "Freelancer", avatarUrl: null });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("answers null for an unknown profile id", async () => {
    await expect(getPublicFreelancerProfile(randomUUID())).resolves.toBeNull();
  });
});
