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

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

type Method = "get" | "post" | "put" | "patch" | "delete";

const authed = (
  method: Method,
  path: string,
  query: Record<string, string> = {},
) =>
  request(app)
    [method](path)
    .set(bearer)
    .query({ role: "freelancer", ...query });

const validAgency = () => ({
  role: "freelancer",
  name: "Acme",
  professionalTitle: "Design studio",
  size: "2-10",
  specialty: "Design",
  website: "https://acme.test",
  overview: "We design",
  tags: ["design", "web"],
  avatarImage: { url: "https://example.test/a.png", imageId: "x" },
  portfolio: [
    {
      title: "Site",
      category: "Web",
      description: "A site",
      liveUrl: null,
      coverImage: { url: "https://example.test/c.png" },
    },
  ],
});

const proposal = () => ({
  role: "freelancer",
  jobId: id,
  coverLetter: "a".repeat(100),
  bidAmountCents: 5000,
  duration: "1 month",
});

describe("agency query and params validation", () => {
  it.each([
    ["get", "/api/v1/agency/mine"],
    ["get", "/api/v1/agency/membership"],
    ["get", "/api/v1/agency/verification"],
    ["get", "/api/v1/agency/jobs"],
    ["get", "/api/v1/agency/connects"],
    ["get", "/api/v1/agency/connects/history"],
    ["get", "/api/v1/agency/proposals"],
    ["get", "/api/v1/agency/proposals/metadata"],
    ["get", "/api/v1/agency/earnings/summary"],
    ["get", "/api/v1/agency/earnings/overview"],
    ["get", "/api/v1/agency/payouts/connect-link"],
    ["get", "/api/v1/agency/team/invitations"],
    ["get", "/api/v1/agency/invitations/mine"],
    ["delete", `/api/v1/agency/team/invitations/${id}`],
    ["delete", `/api/v1/agency/team/members/${id}`],
    ["post", `/api/v1/agency/team/invitations/${id}/resend`],
  ] as const)(
    "%s %s answers 400 for an unknown query key",
    async (method, path) => {
      const response = await authed(method, path, { extra: "1" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    },
  );

  it.each([
    ["delete", "/api/v1/agency/team/invitations/not-a-uuid"],
    ["patch", "/api/v1/agency/team/invitations/not-a-uuid"],
    ["post", "/api/v1/agency/team/invitations/not-a-uuid/resend"],
    ["patch", "/api/v1/agency/team/members/not-a-uuid"],
    ["delete", "/api/v1/agency/team/members/not-a-uuid"],
    ["patch", "/api/v1/agency/invitations/not-a-uuid/respond"],
  ] as const)("%s %s answers 400 for an invalid id", async (method, path) => {
    const response = await authed(method, path);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    "/api/v1/agency/profile/not-a-uuid",
    `/api/v1/agency/profile/${id}?extra=1`,
  ])("GET %s answers 400", async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["an unknown key", "extra=1"],
    ["a role", "role=freelancer"],
    ["an oversized query", `query=${"a".repeat(101)}`],
    ["a bad rate", "maxRateCents=1.5"],
    ["a bad flag", "verifiedOnly=yes"],
    ["an array value", "sizes[]=x"],
    ["an invalid sort", "sort=popular"],
    ["a freelancer-only sort", "sort=success"],
  ])("GET /search answers 400 for %s", async (_name, query) => {
    const response = await request(app).get(`/api/v1/agency/search?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /search passes validation for a valid query", async () => {
    const response = await request(app).get(
      "/api/v1/agency/search?query=a&sort=rating&sizes=a,b&specialty=x&verifiedOnly=true&maxRateCents=9000&offset=0",
    );

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["a bad budget", { minBudgetCents: "1.5" }],
    ["a bad proposals count", { maxProposals: "-1" }],
    ["a bad flag", { paymentVerified: "yes" }],
    ["an invalid filter", { filter: "popular" }],
  ])("GET /jobs answers 400 for %s", async (_name, query) => {
    const response = await authed("get", "/api/v1/agency/jobs", query);

    expect(response.status).toBe(400);
  });

  it("GET /jobs passes validation for a valid query", async () => {
    const response = await authed("get", "/api/v1/agency/jobs", {
      filter: "recent",
      levels: "a",
      durations: "b",
      minProposals: "0",
      paymentVerified: "true",
      minBudgetCents: "500",
    });

    expect(response.status).not.toBe(400);
  });
});

describe("agency body validation", () => {
  const profileCases: [
    string,
    (body: ReturnType<typeof validAgency>) => unknown,
  ][] = [
    ["an unknown key", (body) => ({ ...body, extra: 1 })],
    ["an oversized name", (body) => ({ ...body, name: "a".repeat(101) })],
    [
      "too many tags",
      (body) => ({
        ...body,
        tags: Array.from({ length: 16 }, (_, index) => `t${index}`),
      }),
    ],
    ["an oversized tag", (body) => ({ ...body, tags: ["a".repeat(21)] })],
    [
      "too many portfolio projects",
      (body) => ({
        ...body,
        portfolio: Array.from({ length: 11 }, () => body.portfolio[0]),
      }),
    ],
    ["a wrong type name", (body) => ({ ...body, name: 5 })],
    ["a wrong type tags", (body) => ({ ...body, tags: "x" })],
    [
      "an unknown portfolio key",
      (body) => ({
        ...body,
        portfolio: [{ ...body.portfolio[0], extra: 1 }],
      }),
    ],
  ];

  it.each(profileCases)("PUT / answers 400 for %s", async (_name, mutate) => {
    const response = await request(app)
      .put("/api/v1/agency")
      .set(bearer)
      .send(mutate(validAgency()) as object);

    expect(response.status).toBe(400);
  });

  it("PUT / answers 400 VALIDATION_ERROR for an unknown query key", async () => {
    const response = await authed("put", "/api/v1/agency", {
      extra: "1",
    }).send(validAgency());

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("PUT / passes validation for a valid body with ignored keys", async () => {
    const response = await authed("put", "/api/v1/agency").send({
      ...validAgency(),
      id,
      createdAt: "x",
    });

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["an unknown key", { name: "A", extra: 1 }],
    ["an oversized overview", { overview: "a".repeat(5001) }],
    ["a wrong type", { size: 5 }],
  ])("POST / answers 400 for %s", async (_name, body) => {
    const response = await authed("post", "/api/v1/agency").send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST / passes validation with ignored keys", async () => {
    const response = await authed("post", "/api/v1/agency").send({
      name: "Acme",
      size: "2-10",
      specialty: "Design",
      overview: "We design",
      id,
      imageId: "x",
      createdAt: "x",
      updatedAt: "x",
    });

    expect(response.status).not.toBe(400);
  });

  it("POST / passes validation for a valid body", async () => {
    const response = await authed("post", "/api/v1/agency").send({
      name: "Acme",
      size: "2-10",
      specialty: "Design",
      overview: "We design",
    });

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["an unknown key", { connects: 20, extra: 1 }],
    ["a missing value", {}],
    ["a string value", { connects: "20" }],
  ])("POST /connects/checkout answers 400 for %s", async (_name, body) => {
    const response = await authed(
      "post",
      "/api/v1/agency/connects/checkout",
    ).send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /connects/checkout passes validation for a valid body", async () => {
    const response = await authed(
      "post",
      "/api/v1/agency/connects/checkout",
    ).send({ connects: 20 });

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["an unknown key", { ...proposal(), extra: 1 }],
    ["a missing job id", { ...proposal(), jobId: undefined }],
    ["an invalid job id", { ...proposal(), jobId: "nope" }],
    ["a string bid", { ...proposal(), bidAmountCents: "5000" }],
    ["a short cover letter", { ...proposal(), coverLetter: "short" }],
    [
      "too many answers",
      {
        ...proposal(),
        screeningAnswers: Array.from({ length: 11 }, () => "a"),
      },
    ],
  ])("POST /proposals answers 400 for %s", async (_name, body) => {
    const response = await authed("post", "/api/v1/agency/proposals").send(
      body,
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /proposals passes validation for a valid body", async () => {
    const response = await authed("post", "/api/v1/agency/proposals").send(
      proposal(),
    );

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["an unknown key", { email: "a@b.test", extra: 1 }],
    ["an oversized email", { email: `${"a".repeat(250)}@b.test` }],
    ["a wrong type role", { email: "a@b.test", memberRole: 5 }],
    ["an unknown role", { email: "a@b.test", memberRole: "Owner" }],
  ])("POST /team/invitations answers 400 for %s", async (_name, body) => {
    const response = await authed(
      "post",
      "/api/v1/agency/team/invitations",
    ).send(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /team/invitations passes validation for a valid body", async () => {
    const response = await authed(
      "post",
      "/api/v1/agency/team/invitations",
    ).send({ email: "a@b.test", memberRole: "Business manager" });

    expect(response.status).not.toBe(400);
  });

  it.each([
    ["patch", `/api/v1/agency/team/invitations/${id}`],
    ["patch", `/api/v1/agency/team/members/${id}`],
  ] as const)("%s %s validates the role body", async (method, path) => {
    const invalid = await authed(method, path).send({ memberRole: 5 });
    const unknownRole = await authed(method, path).send({
      memberRole: "Owner",
    });
    const unknown = await authed(method, path).send({ extra: 1 });
    const valid = await authed(method, path).send({
      memberRole: "Business manager",
    });

    expect(invalid.status).toBe(400);
    expect(unknownRole.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(valid.status).not.toBe(400);
  });

  it("PATCH /invitations/:id/respond validates the body", async () => {
    const path = `/api/v1/agency/invitations/${id}/respond`;
    const invalid = await authed("patch", path).send({ accept: "true" });
    const unknown = await authed("patch", path).send({ extra: 1 });
    const valid = await authed("patch", path).send({ accept: true });

    expect(invalid.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(valid.status).not.toBe(400);
  });
});

describe("agency authentication order", () => {
  it.each([
    ["put", "/api/v1/agency"],
    ["post", "/api/v1/agency"],
    ["get", "/api/v1/agency/mine"],
    ["post", "/api/v1/agency/proposals"],
    ["patch", "/api/v1/agency/team/members/not-a-uuid"],
  ] as const)("%s %s answers 401 before 400", async (method, path) => {
    const response = await request(app)
      [method](path)
      .query({ extra: "1" })
      .send(method === "get" ? undefined : { extra: 1 });

    expect(response.status).toBe(401);
  });

  it("PUT / answers 403 before 400 without an account", async () => {
    mocks.accountRows = [];

    const response = await authed("put", "/api/v1/agency").send({ extra: 1 });

    expect(response.status).toBe(403);
  });

  it("answers 400 before the controller's 403 for a client role", async () => {
    const response = await authed("get", "/api/v1/agency/mine", {
      role: "client",
      extra: "1",
    });

    expect(response.status).toBe(400);
  });
});
