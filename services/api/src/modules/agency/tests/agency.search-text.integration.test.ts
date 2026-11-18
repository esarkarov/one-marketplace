import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
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
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../../infrastructure/cache/account-auth.cache.js", () => ({
  invalidateAccountAuthCache: async () => undefined,
}));

import { db, pool } from "../../../database/client.js";
import {
  accounts,
  agency_metadata,
  freelancer_metadata,
} from "../../../test/support/tables.js";
import {
  buildSearchText,
  countryDisplayName,
} from "../../../shared/search/search-text.js";
import { buildAgencySearchText } from "../utils/agency.search-text.js";
import { searchPublicAgencies } from "../services/agency.search.service.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  createAgency,
  updateAgencyProfile,
} from "../services/agency.profile.service.js";
import {
  listAgencyOwnerIds,
  rebuildAgencySearchText,
} from "../services/agency.search-index.service.js";

const PREFIX = "agency-stext-it-";
const newAuthId = () => `${PREFIX}${randomUUID()}`;

const insertAccount = async () => {
  const authId = newAuthId();
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const agencyOf = async (ownerId: string) => {
  const [row] = await db
    .select()
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId));
  return row;
};

const createInput = (ownerId: string) => ({
  ownerId,
  name: "  Northwind   Studio ",
  size: "2-10",
  specialty: "Web Design",
  overview: "We design.",
});

const purge = async () => {
  const like = `${PREFIX}%`;
  await pool.query("delete from agency_members where freelancer_id like $1", [
    like,
  ]);
  await pool.query("delete from agency_metadata where owner_id like $1", [
    like,
  ]);
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
  mocks.getUser.mockResolvedValue({
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    imageUrl: "",
  });
});

describe("agency search_text", () => {
  it("is written on create from name and specialty", async () => {
    const ownerId = await insertAccount();

    await createAgency(createInput(ownerId));

    expect((await agencyOf(ownerId))?.search_text).toBe(
      "northwind studio web design",
    );
  });

  it("is rewritten on update with title and tags", async () => {
    const ownerId = await insertAccount();
    await createAgency(createInput(ownerId));

    await updateAgencyProfile({
      ownerId,
      name: "Northwind Studio",
      professionalTitle: "Brand & Web Agency",
      size: "2-10",
      specialty: "Web Design",
      overview: "We design.",
      tags: ["React", "Figma"],
      portfolio: [],
    });

    expect((await agencyOf(ownerId))?.search_text).toBe(
      "northwind studio brand & web agency web design react figma",
    );
  });

  it("still creates the agency when Clerk fails", async () => {
    const ownerId = await insertAccount();
    mocks.getUser.mockRejectedValue(new Error("clerk down"));

    await createAgency(createInput(ownerId));

    expect(await agencyOf(ownerId)).toBeDefined();
  });
});

describe("rebuildAgencySearchText", () => {
  it("rebuilds from stored data, is idempotent and honours dry run", async () => {
    const ownerId = await insertAccount();
    await createAgency(createInput(ownerId));
    await db
      .update(agency_metadata)
      .set({ search_text: "", tags: ["SEO"], professional_title: "Growth" })
      .where(eq(agency_metadata.owner_id, ownerId));

    await expect(
      rebuildAgencySearchText(ownerId, { dryRun: true }),
    ).resolves.toBe(true);
    expect((await agencyOf(ownerId))?.search_text).toBe("");

    await expect(rebuildAgencySearchText(ownerId)).resolves.toBe(true);
    expect((await agencyOf(ownerId))?.search_text).toBe(
      "northwind studio growth web design seo",
    );

    await expect(rebuildAgencySearchText(ownerId)).resolves.toBe(false);
    await expect(rebuildAgencySearchText("missing-id")).resolves.toBe(false);
    expect(await listAgencyOwnerIds()).toContain(ownerId);
  });
});

describe("searchPublicAgencies text query", () => {
  const newToken = () => `tok${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const seed = async (options: {
    name: string;
    title?: string;
    specialty?: string;
    tags?: string[];
    ownerCity?: string;
    ownerCountry?: string;
    onboarded?: boolean;
  }) => {
    const ownerId = await insertAccount();
    if (options.ownerCity && options.ownerCountry) {
      await db.insert(freelancer_metadata).values({
        auth_id: ownerId,
        professional_title: "Owner",
        professional_description: "x",
        hourly_rate_cents: 1000,
        country: options.ownerCountry,
        city: options.ownerCity,
        weekly_availability: "10",
        experience_level: "EXPERT",
        skills: [],
        languages: [],
        location_text: buildSearchText([
          options.ownerCity,
          countryDisplayName(options.ownerCountry),
        ]),
      });
    }
    const [row] = await db
      .insert(agency_metadata)
      .values({
        owner_id: ownerId,
        name: options.name,
        professional_title: options.title ?? null,
        size: "2-10",
        specialty: options.specialty ?? "general",
        overview: "x",
        tags: options.tags ?? [],
        is_onboarded: options.onboarded ?? true,
        search_text: buildAgencySearchText({
          name: options.name,
          professionalTitle: options.title,
          specialty: options.specialty ?? "general",
          tags: options.tags ?? [],
        }),
      })
      .returning({ id: agency_metadata.id });
    return row!.id;
  };

  const search = async (query: string, limit = 100, offset = 0) =>
    searchPublicAgencies({ query }, { limit, offset });

  it("filters before the page so matches on later offsets are returned", async () => {
    const token = newToken();
    for (let index = 0; index < 5; index += 1) {
      await seed({ name: `${token} studio ${index}` });
    }
    await seed({ name: "unrelated agency" });

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
      name: `${token} Studio`,
      title: "Brand and Web Agency",
    });

    for (const query of [token.toUpperCase(), `agency ${token} BRAND`]) {
      expect((await search(query)).results.map((r) => r.id)).toEqual([id]);
    }
  });

  it("reaches name, title, specialty, tag and the owner's city and country", async () => {
    const token = newToken();
    const id = await seed({
      name: `${token} Collective`,
      title: "Motion Lab",
      specialty: "Animation",
      tags: ["Blender", "AfterEffects"],
      ownerCity: "Lisbon",
      ownerCountry: "PT",
    });
    await seed({
      name: `${token} Other`,
      ownerCity: "Oslo",
      ownerCountry: "NO",
    });

    for (const term of [
      "collective",
      "motion",
      "animation",
      "blender",
      "aftereffects",
      "lisbon",
      "portugal",
      "portugal blender",
    ]) {
      const found = await search(`${token} ${term}`);
      expect(
        found.results.map((r) => r.id),
        term,
      ).toEqual([id]);
    }
  });

  it("excludes agencies that are not onboarded", async () => {
    const token = newToken();
    await seed({ name: `${token} hidden`, onboarded: false });

    expect((await search(token)).results).toHaveLength(0);
  });

  it("treats percent, underscore and backslash literally", async () => {
    const token = newToken();
    const percent = await seed({ name: `${token} 100% agency` });
    await seed({ name: `${token} 1000 agency` });
    const underscore = await seed({ name: `${token} snake_case` });
    await seed({ name: `${token} snakexcase` });
    const backslash = await seed({ name: String.raw`${token} dir\file` });
    await seed({ name: `${token} dirxfile` });

    const ids = async (term: string) =>
      (await search(`${token} ${term}`)).results.map((r) => r.id);
    expect(await ids("100%")).toEqual([percent]);
    expect(await ids("snake_case")).toEqual([underscore]);
    expect(await ids(String.raw`dir\file`)).toEqual([backslash]);
  });

  it("excludes non-matching rows and treats blank queries as no filter", async () => {
    const token = newToken();
    await seed({ name: `${token} alpha` });
    await seed({ name: `${token} beta` });

    expect((await search(`${token} gamma`)).results).toHaveLength(0);
    expect((await search(`${token} alpha beta`)).results).toHaveLength(0);

    for (const blank of ["", "   ", "\t \n"]) {
      const page = await search(blank, 1, 0);
      expect(page.results).toHaveLength(1);
      expect(page.hasMore).toBe(true);
    }
  });
});
