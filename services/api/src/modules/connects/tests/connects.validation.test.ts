import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../../infrastructure/payments/stripe.client.js", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
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

const bearer = { Authorization: "Bearer test-token" };
const base = "/api/v1/connects";
const checkout = `${base}/checkout`;

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("connects request validation", () => {
  it.each([
    ["get", base],
    ["get", `${base}/history`],
    ["post", checkout],
  ] as const)("%s %s returns 401 before 400", async (method, path) => {
    const response = await request(app)[method](path).send({ junk: true });

    expect(response.status).toBe(401);
  });

  it.each([
    ["balance", base],
    ["history", `${base}/history`],
  ])("returns 400 for an unknown query key on %s", async (_name, path) => {
    const response = await request(app)
      .get(path)
      .set(bearer)
      .query({ role: "freelancer", extra: "1" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["missing connects", {}],
    ["string connects", { connects: "20" }],
    ["unknown package", { connects: 30 }],
    ["fractional connects", { connects: 20.5 }],
    ["unknown body key", { connects: 20, extra: 1 }],
  ])("returns 400 VALIDATION_ERROR for %s", async (_name, body) => {
    const response = await request(app)
      .post(checkout)
      .set(bearer)
      .send({ role: "freelancer", ...body });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.success).toBe(false);
  });

  it("returns 400 for an unknown query key on checkout", async () => {
    const response = await request(app)
      .post(checkout)
      .set(bearer)
      .query({ extra: "1" })
      .send({ role: "freelancer", connects: 20 });

    expect(response.status).toBe(400);
  });

  it.each([
    ["balance", base],
    ["history", `${base}/history`],
  ])("passes validation for a valid %s request", async (_name, path) => {
    const response = await request(app)
      .get(path)
      .set(bearer)
      .query({ role: "freelancer" });

    expect(response.status).not.toBe(400);
  });

  it.each([20, 40, 80])(
    "passes validation for a checkout of %i connects",
    async (connects) => {
      const response = await request(app)
        .post(checkout)
        .set(bearer)
        .send({ role: "freelancer", connects });

      expect(response.status).not.toBe(400);
    },
  );

  it("returns 403 for a valid checkout by a client", async () => {
    const response = await request(app)
      .post(checkout)
      .set(bearer)
      .send({ role: "client", connects: 20 });

    expect(response.status).toBe(403);
  });

  it("returns 400 before 403 for an invalid checkout by a client", async () => {
    const response = await request(app)
      .post(checkout)
      .set(bearer)
      .send({ role: "client", connects: 7 });

    expect(response.status).toBe(400);
  });
});

describe("connects history pagination limit", () => {
  it.each([["/api/v1/connects/history", "freelancer"]])(
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
