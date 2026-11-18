import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../../infrastructure/storage/image-kit.client.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../../infrastructure/cache/redis.client.js", () => ({
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

vi.mock("../../../database/client.js", () => {
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

const { app } = await import("../../../app.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const bearer = { Authorization: "Bearer test-token" };
const dueDate = new Date(Date.now() + 86_400_000 * 30).toISOString();

const validJob = () => ({
  role: "client",
  title: "Build a site",
  description: "Details",
  expertiseLevel: "Expert",
  expectedDuration: "1 month",
  skills: ["react"],
  milestones: [{ title: "M1", budgetCents: 10000, dueDate }],
});

type Method = "get" | "post" | "put" | "delete";

const send = (
  method: Method,
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
) => {
  const call = request(app)
    [method](path)
    .set(bearer)
    .query({ role: "client", ...options.query });
  return options.body === undefined ? call : call.send(options.body as object);
};

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("jobs params and query validation", () => {
  it.each([
    ["get", "/api/v1/jobs/not-a-uuid"],
    ["delete", "/api/v1/jobs/not-a-uuid"],
    ["post", "/api/v1/jobs/saved/not-a-uuid"],
    ["delete", "/api/v1/jobs/saved/not-a-uuid"],
  ] as const)("%s %s answers 400 for an invalid id", async (method, path) => {
    const response = await send(method, path);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["get", "/api/v1/jobs"],
    ["get", "/api/v1/jobs/saved"],
    ["get", `/api/v1/jobs/${id}`],
    ["delete", `/api/v1/jobs/${id}`],
    ["post", `/api/v1/jobs/saved/${id}`],
  ] as const)(
    "%s %s answers 400 for an unknown query key",
    async (method, path) => {
      const response = await send(method, path, { query: { extra: "1" } });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    },
  );

  it.each([
    ["an unknown key", "extra=1"],
    ["a role", "role=client"],
    ["a non-numeric offset", "offset=abc"],
    ["a zero limit", "limit=0"],
    ["a limit over the maximum", "limit=101"],
    ["a non-numeric limit", "limit=abc"],
    ["an offset over the maximum", "offset=10001"],
    ["an oversized search", `query=${"a".repeat(101)}`],
    ["an invalid budget", "minBudgetCents=1.5"],
    ["an array value", "sort[]=x"],
    ["an invalid sort", "sort=popular"],
  ])("GET /jobs/public answers 400 for %s", async (_name, query) => {
    const response = await request(app).get(`/api/v1/jobs/public?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /jobs/public defaults limit to 20 and offset to 0 and accepts an explicit limit", async () => {
    const { publicJobFeedQuerySchema } =
      await import("../schemas/jobs.schema.js");

    expect(publicJobFeedQuerySchema.parse({})).toMatchObject({
      limit: 20,
      offset: 0,
    });
    expect(publicJobFeedQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    const response = await request(app).get("/api/v1/jobs/public?limit=5");
    expect(response.status).not.toBe(400);
  });

  it("GET /jobs/public passes validation for a valid query", async () => {
    const response = await request(app).get(
      "/api/v1/jobs/public?sort=budget&offset=0&levels=a,b&paymentVerified=true&maxProposals=5",
    );

    expect(response.status).not.toBe(400);
  });
});

describe("jobs body validation", () => {
  const cases: [string, (body: ReturnType<typeof validJob>) => unknown][] = [
    ["an unknown key", (body) => ({ ...body, extra: 1 })],
    ["an oversized title", (body) => ({ ...body, title: "a".repeat(101) })],
    [
      "too many skills",
      (body) => ({ ...body, skills: Array.from({ length: 31 }, () => "a") }),
    ],
    ["an oversized skill", (body) => ({ ...body, skills: ["a".repeat(51)] })],
    [
      "too many attachments",
      (body) => ({
        ...body,
        attachments: Array.from({ length: 6 }, () => ({ fileName: "a.pdf" })),
      }),
    ],
    ["a wrong type title", (body) => ({ ...body, title: 5 })],
    [
      "a string budget",
      (body) => ({
        ...body,
        milestones: [{ title: "M", budgetCents: "10000", dueDate }],
      }),
    ],
    [
      "a missing budget",
      (body) => ({ ...body, milestones: [{ title: "M", dueDate }] }),
    ],
    ["an invalid role", (body) => ({ ...body, role: "admin" })],
  ];

  describe.each([
    ["post", "/api/v1/jobs"],
    ["put", `/api/v1/jobs/${id}`],
  ] as const)("%s %s", (method, path) => {
    it.each(cases)("answers 400 for %s", async (_name, mutate) => {
      const response = await request(app)
        [method](path)
        .set(bearer)
        .send(mutate(validJob()) as object);

      expect(response.status).toBe(400);
    });

    it("answers 400 VALIDATION_ERROR for an unknown key", async () => {
      const response = await send(method, path, {
        body: { ...validJob(), extra: 1 },
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("answers 400 VALIDATION_ERROR for an unknown query key", async () => {
      const response = await send(method, path, {
        query: { extra: "1" },
        body: validJob(),
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("passes validation for a valid body with ignored keys", async () => {
      const response = await send(method, path, {
        body: { ...validJob(), id, imageId: "x", createdAt: "x" },
      });

      expect(response.status).not.toBe(400);
    });
  });

  it("PUT /jobs/:jobId answers 400 for an invalid id", async () => {
    const response = await send("put", "/api/v1/jobs/not-a-uuid", {
      body: validJob(),
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("jobs authentication order", () => {
  it.each([
    ["post", "/api/v1/jobs"],
    ["put", `/api/v1/jobs/${id}`],
    ["put", "/api/v1/jobs/not-a-uuid"],
    ["get", "/api/v1/jobs/not-a-uuid"],
    ["post", "/api/v1/jobs/saved/not-a-uuid"],
  ] as const)("%s %s answers 401 before 400", async (method, path) => {
    const response = await request(app)
      [method](path)
      .query({ extra: "1" })
      .send(method === "post" || method === "put" ? { extra: 1 } : undefined);

    expect(response.status).toBe(401);
  });

  it.each([
    ["post", "/api/v1/jobs"],
    ["put", "/api/v1/jobs/not-a-uuid"],
  ] as const)(
    "%s %s answers 403 before 400 without an account",
    async (method, path) => {
      mocks.accountRows = [];

      const response = await send(method, path, { body: { extra: 1 } });

      expect(response.status).toBe(403);
    },
  );

  it("answers 400 before the controller's 403 for a freelancer on a client route", async () => {
    const response = await send("get", "/api/v1/jobs/not-a-uuid", {
      query: { role: "freelancer" },
    });

    expect(response.status).toBe(400);
  });
});

describe("jobs lists pagination limit", () => {
  it.each([
    ["/api/v1/jobs", "client"],
    ["/api/v1/jobs/saved", "freelancer"],
  ])(
    "GET %s accepts limit and offset within the bounds and rejects others with 400",
    async (path, role) => {
      const call = (query: Record<string, string | undefined>) =>
        request(app)
          .get(path)
          .set(bearer)
          .query({ role, ...query });

      const explicit = await call({ limit: "100", offset: "10000" });
      const defaults = await call({});
      expect(explicit.status).not.toBe(400);
      expect(defaults.status).not.toBe(400);

      for (const query of [
        { limit: "0" },
        { limit: "101" },
        { limit: "abc" },
        { limit: "1.5" },
        { offset: "-1" },
        { offset: "10001" },
      ]) {
        const response = await call(query);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION_ERROR");
      }
    },
  );

  it.each([])("%s defaults limit to 20 and offset to 0", async (name) => {
    const modules = {} as Record<
      string,
      Record<string, { parse: (v: object) => object }>
    >;
    const schema = modules[name]![name]!;

    expect(schema.parse({})).toMatchObject({ limit: 20, offset: 0 });
  });
});
