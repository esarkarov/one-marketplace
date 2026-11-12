import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
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

const mocks = vi.hoisted(() => {
  process.env.IMAGEKIT_PRIVATE_KEY = "private_test_imagekit_key";
  return { upload: vi.fn(), remove: vi.fn() };
});

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: mocks.remove } },
}));

vi.mock("../../infrastructure/events/publisher.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../infrastructure/events/publisher.js")
  >()),
  sendNotification: vi.fn(),
}));

import { db, pool } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  agency_portfolios,
  freelancer_metadata,
  freelancer_portfolios,
} from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { updateAgencyProfile } from "../../modules/agency/agency.service.js";
import { saveFreelancerProfile } from "../../modules/freelancer/freelancer.service.js";

const PREFIX = "img-it-";
const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

const purge = async () => {
  await db.delete(accounts).where(like(accounts.auth_id, `${PREFIX}%`));
};

const insertFreelancerAccount = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    created_at: new Date(),
    updated_at: new Date(),
  });
  return authId;
};

const freelancerInput = (
  userId: string,
  portfolios: Array<{ url: string; live_url?: string | null }>,
) => ({
  userId,
  professional_title: "Engineer",
  professional_description: "Builds things",
  hourly_rate_cents: 5000,
  country: "US",
  city: "Austin",
  availability_status: "AVAILABLE",
  weekly_availability: "30+",
  experience_level: "EXPERT",
  skills: ["a", "b", "c"],
  languages: [{ language: "English", proficiency: "Native" }],
  portfolios: portfolios.map((item, index) => ({
    title: `Project ${index}`,
    category: "Web",
    description: "Description",
    live_url: item.live_url ?? null,
    cover_image: { url: item.url },
  })),
});

const seedFreelancer = async (
  covers: Array<{ imageId: string; url: string }>,
) => {
  const userId = await insertFreelancerAccount();
  const [metadata] = await db
    .insert(freelancer_metadata)
    .values({
      auth_id: userId,
      professional_title: "Engineer",
      professional_description: "Builds things",
      hourly_rate_cents: 5000,
      country: "US",
      city: "Austin",
      weekly_availability: "30+",
      experience_level: "EXPERT",
      languages: [],
    })
    .returning({ id: freelancer_metadata.id });
  for (const cover of covers) {
    await db.insert(freelancer_portfolios).values({
      freelancer_id: metadata!.id,
      title: "Old",
      category: "Web",
      description: "Old",
      cover_image: cover,
    });
  }
  return { userId, metadataId: metadata!.id };
};

const readFreelancerCovers = async (metadataId: string) =>
  (
    await db
      .select({ cover: freelancer_portfolios.cover_image })
      .from(freelancer_portfolios)
      .where(eq(freelancer_portfolios.freelancer_id, metadataId))
  ).map((row) => row.cover);

const seedAgency = async (
  covers: Array<{ imageId: string; url: string }>,
  avatar?: { imageId: string; url: string },
) => {
  const ownerId = await insertFreelancerAccount();
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: "Agency",
      size: "1-10",
      specialty: "testing",
      overview: "overview",
      is_onboarded: true,
      avatar_image: avatar ?? null,
    })
    .returning({ id: agency_metadata.id });
  for (const cover of covers) {
    await db.insert(agency_portfolios).values({
      agency_id: agency!.id,
      title: "Old",
      category: "Web",
      description: "Old",
      cover_image: cover,
    });
  }
  return { ownerId, agencyId: agency!.id };
};

const agencyInput = (
  ownerId: string,
  portfolio: Array<{ url: string }>,
  avatarUrl?: string,
) => ({
  ownerId,
  name: "Agency",
  professionalTitle: "Studio",
  size: "1-10",
  specialty: "testing",
  overview: "overview",
  tags: [],
  avatarImage: avatarUrl ? { url: avatarUrl } : undefined,
  portfolio: portfolio.map((item, index) => ({
    title: `Project ${index}`,
    category: "Web",
    description: "Description",
    coverImage: { url: item.url },
  })),
});

const readAgencyCovers = async (agencyId: string) =>
  (
    await db
      .select({ cover: agency_portfolios.cover_image })
      .from(agency_portfolios)
      .where(eq(agency_portfolios.agency_id, agencyId))
  ).map((row) => row.cover);

const deletedIds = () => mocks.remove.mock.calls.map(([id]) => id);

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.remove.mockResolvedValue({});
  let counter = 0;
  mocks.upload.mockImplementation(async () => {
    counter += 1;
    return {
      fileId: `ik-new-${counter}`,
      url: `https://ik.example.test/new-${counter}.png`,
    };
  });
});

afterEach(purge);

describe("freelancer portfolio images", () => {
  const own = {
    imageId: "ik-own-1",
    url: "https://ik.example.test/own-1.png",
  };

  it("reuses the caller's own stored url without uploading or deleting", async () => {
    const { userId, metadataId } = await seedFreelancer([own]);

    await saveFreelancerProfile(
      freelancerInput(userId, [{ url: own.url }]),
      true,
    );

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await readFreelancerCovers(metadataId)).toEqual([own]);
  });

  it("rejects a foreign non-data url with 400 and stores nothing", async () => {
    const { userId, metadataId } = await seedFreelancer([own]);

    await expect(
      saveFreelancerProfile(
        freelancerInput(userId, [
          { url: "https://evil.example.test/steal.png" },
        ]),
        true,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await readFreelancerCovers(metadataId)).toEqual([own]);
  });

  it("never deletes an id the client could have supplied", async () => {
    const { userId } = await seedFreelancer([own]);
    const other = await seedFreelancer([
      { imageId: "ik-victim", url: "https://ik.example.test/victim.png" },
    ]);

    await expect(
      saveFreelancerProfile(
        freelancerInput(userId, [
          { url: "https://ik.example.test/victim.png" },
        ]),
        true,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(deletedIds()).not.toContain("ik-victim");
    expect(await readFreelancerCovers(other.metadataId)).toHaveLength(1);
  });

  it("deletes only the caller's own dropped ids and uploads new data urls", async () => {
    const second = {
      imageId: "ik-own-2",
      url: "https://ik.example.test/own-2.png",
    };
    const { userId, metadataId } = await seedFreelancer([own, second]);
    const other = await seedFreelancer([
      { imageId: "ik-other", url: "https://ik.example.test/other.png" },
    ]);

    await saveFreelancerProfile(
      freelancerInput(userId, [{ url: own.url }, { url: DATA_URL }]),
      true,
    );

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(deletedIds()).toEqual(["ik-own-2"]);
    const covers = await readFreelancerCovers(metadataId);
    expect(covers.map((cover) => cover.imageId).sort()).toEqual([
      "ik-new-1",
      "ik-own-1",
    ]);
    expect(await readFreelancerCovers(other.metadataId)).toHaveLength(1);
  });
});

describe("agency portfolio images", () => {
  const own = {
    imageId: "ik-agency-own-1",
    url: "https://ik.example.test/agency-own-1.png",
  };

  it("reuses the caller's own stored url without uploading or deleting", async () => {
    const { ownerId, agencyId } = await seedAgency([own]);

    await updateAgencyProfile(agencyInput(ownerId, [{ url: own.url }]));

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await readAgencyCovers(agencyId)).toEqual([own]);
  });

  it("rejects a foreign non-data url with 400 and stores nothing", async () => {
    const { ownerId, agencyId } = await seedAgency([own]);

    await expect(
      updateAgencyProfile(
        agencyInput(ownerId, [{ url: "https://evil.example.test/steal.png" }]),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(await readAgencyCovers(agencyId)).toEqual([own]);
  });

  it("rejects a foreign avatar url and never deletes foreign ids", async () => {
    const { ownerId } = await seedAgency([own]);
    const other = await seedAgency([
      {
        imageId: "ik-agency-victim",
        url: "https://ik.example.test/agency-victim.png",
      },
    ]);

    await expect(
      updateAgencyProfile(
        agencyInput(
          ownerId,
          [{ url: own.url }],
          "https://ik.example.test/agency-victim.png",
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(deletedIds()).not.toContain("ik-agency-victim");
    expect(await readAgencyCovers(other.agencyId)).toHaveLength(1);
  });

  it("deletes only the caller's own dropped ids and uploads new data urls", async () => {
    const second = {
      imageId: "ik-agency-own-2",
      url: "https://ik.example.test/agency-own-2.png",
    };
    const { ownerId, agencyId } = await seedAgency([own, second]);
    const other = await seedAgency([
      {
        imageId: "ik-agency-other",
        url: "https://ik.example.test/agency-other.png",
      },
    ]);

    await updateAgencyProfile(
      agencyInput(ownerId, [{ url: own.url }, { url: DATA_URL }]),
    );

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(deletedIds()).toEqual(["ik-agency-own-2"]);
    const covers = await readAgencyCovers(agencyId);
    expect(covers.map((cover) => cover.imageId).sort()).toEqual([
      "ik-agency-own-1",
      "ik-new-1",
    ]);
    expect(await readAgencyCovers(other.agencyId)).toHaveLength(1);
  });
});
