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

import { db, pool } from "../../../database/client.js";
import { accounts, freelancer_metadata } from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { saveFreelancerProfile } from "../services/freelancer.profile.service.js";
import {
  listFreelancerAuthIds,
  rebuildFreelancerSearchText,
} from "../services/freelancer.search-index.service.js";

const PREFIX = "freelancer-search-text-";
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
