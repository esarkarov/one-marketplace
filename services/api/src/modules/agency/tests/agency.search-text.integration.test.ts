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
import { accounts, agency_metadata } from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import {
  createAgency,
  updateAgencyProfile,
} from "../services/agency.profile.service.js";
import {
  listAgencyOwnerIds,
  rebuildAgencySearchText,
} from "../services/agency.search-index.service.js";

const PREFIX = "agency-search-text-";
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
