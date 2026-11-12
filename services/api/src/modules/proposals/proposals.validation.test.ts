import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

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
const base = "/api/v1/proposals";

const proposal = {
  jobId: id,
  coverLetter: "x".repeat(80),
  bidAmountCents: 1000,
  duration: "2 weeks",
};

type Method = "get" | "post" | "patch";

const call = (
  method: Method,
  path: string,
  { role, body, query }: { role: string; body?: object; query?: object },
) => {
  const req = request(app)[method](path).set(bearer);
  if (method === "get") return req.query({ role, ...query });
  return req.send({ role, ...body });
};

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("proposals authentication", () => {
  it.each([
    ["get", base],
    ["get", `${base}/metadata`],
    ["post", base],
    ["patch", `${base}/not-a-uuid/status`],
    ["post", `${base}/not-a-uuid/interview`],
  ] as const)("%s %s returns 401 before 400", async (method, path) => {
    const response = await request(app)[method](path).send({ junk: true });

    expect(response.status).toBe(401);
  });
});

describe("proposals request validation", () => {
  it.each([
    [
      "bad proposal id on status",
      "patch",
      `${base}/nope/status`,
      "client",
      { body: {} },
    ],
    [
      "bad proposal id on interview",
      "post",
      `${base}/nope/interview`,
      "client",
      { body: { message: "hi" } },
    ],
    [
      "unknown query key on list",
      "get",
      base,
      "freelancer",
      { query: { extra: "1" } },
    ],
    ["bad jobId on list", "get", base, "client", { query: { jobId: "nope" } }],
    [
      "unknown query key on metadata",
      "get",
      `${base}/metadata`,
      "freelancer",
      { query: { extra: "1" } },
    ],
    [
      "unknown body key on create",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, extra: 1 } },
    ],
    [
      "short cover letter",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, coverLetter: "short" } },
    ],
    [
      "oversized cover letter",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, coverLetter: "x".repeat(10_001) } },
    ],
    [
      "oversized duration",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, duration: "x".repeat(51) } },
    ],
    [
      "too many screening answers",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, screeningAnswers: Array(11).fill("a") } },
    ],
    [
      "oversized screening answer",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, screeningAnswers: ["x".repeat(5001)] } },
    ],
    [
      "non-string screening answer",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, screeningAnswers: [1] } },
    ],
    [
      "missing job id",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, jobId: undefined } },
    ],
    [
      "string bid amount",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, bidAmountCents: "1000" } },
    ],
    [
      "unknown key on status",
      "patch",
      `${base}/${id}/status`,
      "client",
      { body: { extra: 1 } },
    ],
    [
      "string isShortlisted",
      "patch",
      `${base}/${id}/status`,
      "client",
      { body: { isShortlisted: "true" } },
    ],
    [
      "missing interview message",
      "post",
      `${base}/${id}/interview`,
      "client",
      { body: {} },
    ],
    [
      "oversized interview message",
      "post",
      `${base}/${id}/interview`,
      "client",
      { body: { message: "x".repeat(5001) } },
    ],
    [
      "non-string interview message",
      "post",
      `${base}/${id}/interview`,
      "client",
      { body: { message: 5 } },
    ],
    [
      "unknown interview key",
      "post",
      `${base}/${id}/interview`,
      "client",
      { body: { message: "hi", extra: 1 } },
    ],
  ] as const)(
    "returns 400 VALIDATION_ERROR for %s",
    async (_name, method, path, role, input) => {
      const response = await call(method, path, { role, ...input });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(response.body.success).toBe(false);
    },
  );

  it.each([
    ["list", "get", base, "freelancer", {}],
    ["list for client", "get", base, "client", { query: { jobId: id } }],
    ["metadata", "get", `${base}/metadata`, "freelancer", {}],
    ["create", "post", base, "freelancer", { body: proposal }],
    [
      "create with answers",
      "post",
      base,
      "freelancer",
      { body: { ...proposal, screeningAnswers: ["a", ""] } },
    ],
    ["mark viewed without body", "patch", `${base}/${id}/status`, "client", {}],
    [
      "shortlist",
      "patch",
      `${base}/${id}/status`,
      "client",
      { body: { isShortlisted: true } },
    ],
    [
      "interview",
      "post",
      `${base}/${id}/interview`,
      "client",
      { body: { message: "hello" } },
    ],
  ] as const)("passes validation for a valid %s", async (...args) => {
    const [, method, path, role, input] = args;
    const response = await call(method, path, { role, ...input });

    expect(response.status).not.toBe(400);
  });

  it("returns 403 for a valid create by a client", async () => {
    const response = await call("post", base, {
      role: "client",
      body: proposal,
    });

    expect(response.status).toBe(403);
  });

  it("returns 400 before 403 for invalid input from the wrong role", async () => {
    const response = await call("post", base, {
      role: "client",
      body: { ...proposal, extra: 1 },
    });

    expect(response.status).toBe(400);
  });
});
