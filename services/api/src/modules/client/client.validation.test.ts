import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../config/imageKit.js", () => ({
  imageKit: { files: { upload: vi.fn(), delete: vi.fn() } },
}));

vi.mock("../../config/redis.js", () => ({
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

const authed = (
  method: "get" | "put",
  path: string,
  query: Record<string, string> = {},
) =>
  request(app)
    [method](path)
    .set(bearer)
    .query({ role: "client", ...query });

const validProfile = () => ({
  role: "client",
  professionalRole: "CTO",
  companyName: "Acme",
  companyWebsite: "https://acme.test",
  companySize: "11-50",
  industry: "Software",
  companyDescription: "We build things",
});

describe("client query validation", () => {
  it.each([
    "/api/v1/client/profile",
    "/api/v1/client/hiring-overview",
    "/api/v1/client/completed-contracts",
    "/api/v1/client/dashboard-overview",
    "/api/v1/client/finances/manage-link",
    "/api/v1/client/marketplace/search",
  ])("GET %s answers 400 for an unknown query key", async (path) => {
    const response = await authed("get", path, { extra: "1" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["an oversized query", { query: "a".repeat(101) }],
    ["a bad offset", { offset: "-1" }],
    ["an oversized type", { type: "a".repeat(33) }],
  ])("GET /marketplace/search answers 400 for %s", async (_name, query) => {
    const response = await authed(
      "get",
      "/api/v1/client/marketplace/search",
      query,
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("GET /marketplace/search passes validation for a valid query", async () => {
    const response = await authed("get", "/api/v1/client/marketplace/search", {
      query: "a",
      type: "agency",
      offset: "0",
    });

    expect(response.status).not.toBe(400);
  });
});

describe("PUT /client/profile validation", () => {
  const cases: [string, (body: ReturnType<typeof validProfile>) => unknown][] =
    [
      ["an unknown key", (body) => ({ ...body, extra: 1 })],
      [
        "an oversized name",
        (body) => ({ ...body, companyName: "a".repeat(101) }),
      ],
      [
        "an oversized description",
        (body) => ({ ...body, companyDescription: "a".repeat(5001) }),
      ],
      ["a wrong type", (body) => ({ ...body, industry: 5 })],
      ["an invalid role", (body) => ({ ...body, role: "admin" })],
    ];

  it.each(cases)("answers 400 for %s", async (_name, mutate) => {
    const response = await request(app)
      .put("/api/v1/client/profile")
      .set(bearer)
      .send(mutate(validProfile()) as object);

    expect(response.status).toBe(400);
  });

  it("answers 400 VALIDATION_ERROR for an unknown key", async () => {
    const response = await authed("put", "/api/v1/client/profile").send({
      ...validProfile(),
      extra: 1,
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("passes validation for a valid body with ignored keys", async () => {
    const response = await authed("put", "/api/v1/client/profile").send({
      ...validProfile(),
      id,
      createdAt: "x",
    });

    expect(response.status).not.toBe(400);
  });
});

describe("client authentication order", () => {
  it.each([
    ["get", "/api/v1/client/profile"],
    ["put", "/api/v1/client/profile"],
    ["get", "/api/v1/client/marketplace/search"],
  ] as const)("%s %s answers 401 before 400", async (method, path) => {
    const response = await request(app)
      [method](path)
      .query({ extra: "1" })
      .send(method === "put" ? { extra: 1 } : undefined);

    expect(response.status).toBe(401);
  });

  it("answers 403 before 400 without an account", async () => {
    mocks.accountRows = [];

    const response = await authed("get", "/api/v1/client/profile", {
      extra: "1",
    });

    expect(response.status).toBe(403);
  });

  it("answers 400 before the controller's 403 for a freelancer", async () => {
    const response = await authed("get", "/api/v1/client/profile", {
      role: "freelancer",
      extra: "1",
    });

    expect(response.status).toBe(400);
  });
});
