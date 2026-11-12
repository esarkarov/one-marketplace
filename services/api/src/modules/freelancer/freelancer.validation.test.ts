import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../infrastructure/image-kit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

vi.mock("../../database/client.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => mocks.accountRows,
  };
  return {
    db: { select: () => chain },
    pool: { end: async () => undefined },
  };
});

const { app } = await import("../../app.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const bearer = { Authorization: "Bearer test-token" };

const validProfile = () => ({
  role: "freelancer",
  freelancer_metadata: {
    professional_title: "Developer",
    professional_description: "Builds things",
    hourly_rate_cents: 5000,
    country: "US",
    city: "NYC",
    availability_status: "available",
    weekly_availability: "30",
    experience_level: "expert",
    skills: ["react", "node", "sql"],
    languages: [{ language: "English", proficiency: "Native" }],
  },
  freelancer_portfolios: [
    {
      title: "Site",
      category: "Web",
      description: "A site",
      live_url: null,
      cover_image: { url: "https://example.test/a.png", imageId: "x" },
    },
  ],
});

type Profile = ReturnType<typeof validProfile>;

const authed = (
  method: "get" | "put",
  path: string,
  query: Record<string, string> = {},
) =>
  request(app)
    [method](path)
    .set(bearer)
    .query({ role: "freelancer", ...query });

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("freelancer params and query validation", () => {
  it("GET /jobs/:id answers 400 for an invalid id", async () => {
    const response = await authed("get", "/api/v1/freelancer/jobs/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["/api/v1/freelancer/profile/not-a-uuid"],
    [`/api/v1/freelancer/profile/${id}?extra=1`],
  ])("GET %s answers 400", async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["/api/v1/freelancer/profile"],
    ["/api/v1/freelancer/earnings/summary"],
    ["/api/v1/freelancer/earnings/overview"],
    ["/api/v1/freelancer/earnings/certificate"],
    ["/api/v1/freelancer/payouts/connect-link"],
    [`/api/v1/freelancer/jobs/${id}`],
    ["/api/v1/freelancer/jobs"],
  ])("GET %s answers 400 for an unknown query key", async (path) => {
    const response = await authed("get", path, { extra: "1" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["an unknown key", "extra=1"],
    ["a role", "role=client"],
    ["an oversized query", `query=${"a".repeat(101)}`],
    ["a bad offset", "offset=-1"],
    ["a bad rate", "minRateCents=1.5"],
    ["a bad rating", "minRating=abc"],
    ["a bad flag", "verifiedOnly=yes"],
    ["an array value", "sort[]=x"],
    ["an invalid sort", "sort=popular"],
  ])("GET /search answers 400 for %s", async (_name, query) => {
    const response = await request(app).get(
      `/api/v1/freelancer/search?${query}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /search passes validation for a valid query", async () => {
    const response = await request(app).get(
      "/api/v1/freelancer/search?query=a&sort=rating&offset=0&verifiedOnly=true&minRating=4.5&minSuccess=90&minRateCents=500&maxRateCents=9000",
    );

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["a bad budget", { minBudgetCents: "1.5" }],
    ["a bad proposals count", { minProposals: "-1" }],
    ["a bad flag", { paymentVerified: "yes" }],
    ["an oversized filter", { levels: "a".repeat(300) }],
    ["an invalid filter", { filter: "popular" }],
  ])("GET /jobs answers 400 for %s", async (_name, query) => {
    const response = await authed("get", "/api/v1/freelancer/jobs", query);

    expect(response.status).toBe(400);
  });

  it("GET /jobs passes validation for a valid query", async () => {
    const response = await authed("get", "/api/v1/freelancer/jobs", {
      filter: "recent",
      levels: "a,b",
      durations: "x",
      minProposals: "0",
      maxProposals: "5",
      paymentVerified: "true",
      minBudgetCents: "500",
      maxBudgetCents: "9000",
    });

    expect(response.status).not.toBe(400);
  });
});

describe("PUT /freelancer/profile validation", () => {
  const cases: [string, (body: Profile) => unknown][] = [
    ["an unknown key", (body) => ({ ...body, extra: 1 })],
    [
      "an unknown metadata key",
      (body) => ({
        ...body,
        freelancer_metadata: { ...body.freelancer_metadata, extra: 1 },
      }),
    ],
    [
      "an oversized title",
      (body) => ({
        ...body,
        freelancer_metadata: {
          ...body.freelancer_metadata,
          professional_title: "a".repeat(101),
        },
      }),
    ],
    [
      "an oversized skill",
      (body) => ({
        ...body,
        freelancer_metadata: {
          ...body.freelancer_metadata,
          skills: ["a", "b", "a".repeat(21)],
        },
      }),
    ],
    [
      "too many skills",
      (body) => ({
        ...body,
        freelancer_metadata: {
          ...body.freelancer_metadata,
          skills: Array.from({ length: 16 }, (_, index) => `s${index}`),
        },
      }),
    ],
    [
      "too many portfolios",
      (body) => ({
        ...body,
        freelancer_portfolios: Array.from(
          { length: 11 },
          () => body.freelancer_portfolios[0],
        ),
      }),
    ],
    [
      "a missing metadata object",
      ({ freelancer_metadata: _unused, ...rest }) => rest,
    ],
    [
      "a string rate",
      (body) => ({
        ...body,
        freelancer_metadata: {
          ...body.freelancer_metadata,
          hourly_rate_cents: "5000",
        },
      }),
    ],
    ["a wrong type title", (body) => ({ ...body, freelancer_portfolios: "x" })],
  ];

  it.each(cases)("answers 400 for %s", async (_name, mutate) => {
    const response = await authed("put", "/api/v1/freelancer/profile").send(
      mutate(validProfile()) as object,
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 400 for an unknown query key", async () => {
    const response = await authed("put", "/api/v1/freelancer/profile", {
      extra: "1",
    }).send(validProfile());

    expect(response.status).toBe(400);
  });

  it("passes validation for a valid body with ignored keys", async () => {
    const response = await authed("put", "/api/v1/freelancer/profile").send({
      ...validProfile(),
      id,
      createdAt: "x",
    });

    expect(response.status).not.toBe(400);
  });
});

describe("freelancer authentication order", () => {
  it.each([
    ["put", "/api/v1/freelancer/profile"],
    ["get", "/api/v1/freelancer/jobs"],
    ["get", "/api/v1/freelancer/jobs/not-a-uuid"],
  ] as const)("%s %s answers 401 before 400", async (method, path) => {
    const response = await request(app)
      [method](path)
      .query({ extra: "1" })
      .send(method === "put" ? { extra: 1 } : undefined);

    expect(response.status).toBe(401);
  });

  it("PUT /profile answers 403 before 400 without an account", async () => {
    mocks.accountRows = [];

    const response = await authed("put", "/api/v1/freelancer/profile").send({
      extra: 1,
    });

    expect(response.status).toBe(403);
  });

  it("GET /jobs answers 403 before 400 without an account", async () => {
    mocks.accountRows = [];

    const response = await authed("get", "/api/v1/freelancer/jobs", {
      minBudgetCents: "x",
    });

    expect(response.status).toBe(403);
  });
});
