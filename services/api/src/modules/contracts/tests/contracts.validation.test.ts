import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../../../infrastructure/stripe.js", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("../../../infrastructure/redis.js", () => ({
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
const base = "/api/v1/contracts";
const milestone = `${base}/${id}/milestones/${id}`;
const future = new Date(Date.now() + 86_400_000 * 30)
  .toISOString()
  .slice(0, 10);

type Method = "get" | "post" | "patch";
type Input = { query?: object; body?: object };

const call = (method: Method, path: string, role: string, input: Input) => {
  const req = request(app)[method](path).set(bearer);
  if (method === "get") return req.query({ role, ...input.query });
  return req.query(input.query ?? {}).send({ role, ...input.body });
};

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("contracts authentication", () => {
  it.each([
    ["get", `${base}/client`],
    ["get", `${base}/freelancer`],
    ["patch", `${base}/nope/accept`],
    ["patch", `${milestone}/submit`],
    ["patch", `${milestone}/review`],
    ["post", `${base}/checkout`],
    ["post", `${milestone}/checkout`],
    ["post", `${base}/${id}/milestones`],
    ["post", `${base}/${id}/finish`],
  ] as const)("%s %s returns 401 before 400", async (method, path) => {
    const response = await request(app)[method](path).send({ junk: true });

    expect(response.status).toBe(401);
  });
});

describe("contracts request validation", () => {
  const review = { action: "APPROVE" };
  const submit = { submissionMessage: "Work is finished." };
  const add = { title: "Extra work", amountCents: 1000, dueDate: future };
  const finish = { rating: 5, comment: "Great collaboration." };

  it.each([
    [
      "unknown query on client list",
      "get",
      `${base}/client`,
      "client",
      { query: { extra: "1" } },
    ],
    [
      "invalid scope on freelancer list",
      "get",
      `${base}/freelancer`,
      "freelancer",
      { query: { scope: "team" } },
    ],
    [
      "bad contract id on accept",
      "patch",
      `${base}/nope/accept`,
      "freelancer",
      {},
    ],
    [
      "invalid scope on accept",
      "patch",
      `${base}/${id}/accept`,
      "freelancer",
      { query: { scope: "x" } },
    ],
    [
      "bad milestone id on submit",
      "patch",
      `${base}/${id}/milestones/nope/submit`,
      "freelancer",
      { body: submit },
    ],
    [
      "missing submission message",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: {} },
    ],
    [
      "short submission message",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: { submissionMessage: "short" } },
    ],
    [
      "oversized submission message",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: { submissionMessage: "x".repeat(5001) } },
    ],
    [
      "oversized delivery link",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      {
        body: {
          ...submit,
          submissionDeliveryLink: `https://a.test/${"x".repeat(2048)}`,
        },
      },
    ],
    [
      "unknown submit key",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: { ...submit, extra: 1 } },
    ],
    [
      "numeric delivery link",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: { ...submit, submissionDeliveryLink: 5 } },
    ],
    [
      "bad milestone id on review",
      "patch",
      `${base}/${id}/milestones/nope/review`,
      "client",
      { body: review },
    ],
    [
      "invalid review action",
      "patch",
      `${milestone}/review`,
      "client",
      { body: { action: "REJECT" } },
    ],
    [
      "missing review action",
      "patch",
      `${milestone}/review`,
      "client",
      { body: {} },
    ],
    [
      "oversized feedback",
      "patch",
      `${milestone}/review`,
      "client",
      { body: { ...review, feedback: "x".repeat(5001) } },
    ],
    [
      "unknown review key",
      "patch",
      `${milestone}/review`,
      "client",
      { body: { ...review, extra: 1 } },
    ],
    ["missing proposal id", "post", `${base}/checkout`, "client", { body: {} }],
    [
      "bad proposal id",
      "post",
      `${base}/checkout`,
      "client",
      { body: { proposalId: "nope" } },
    ],
    [
      "unknown checkout key",
      "post",
      `${base}/checkout`,
      "client",
      { body: { proposalId: id, extra: 1 } },
    ],
    [
      "bad ids on milestone checkout",
      "post",
      `${base}/nope/milestones/${id}/checkout`,
      "client",
      { body: {} },
    ],
    [
      "oversized requirements",
      "post",
      `${milestone}/checkout`,
      "client",
      { body: { requirements: "x".repeat(501) } },
    ],
    [
      "non-string requirements",
      "post",
      `${milestone}/checkout`,
      "client",
      { body: { requirements: 5 } },
    ],
    [
      "unknown milestone checkout key",
      "post",
      `${milestone}/checkout`,
      "client",
      { body: { extra: 1 } },
    ],
    [
      "bad contract id on add milestone",
      "post",
      `${base}/nope/milestones`,
      "client",
      { body: add },
    ],
    [
      "short milestone title",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, title: "ab" } },
    ],
    [
      "long milestone title",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, title: "x".repeat(121) } },
    ],
    [
      "amount below minimum",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, amountCents: 999 } },
    ],
    [
      "fractional amount",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, amountCents: 1000.5 } },
    ],
    [
      "string amount",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, amountCents: "1000" } },
    ],
    [
      "invalid due date",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, dueDate: "2025-13-45" } },
    ],
    [
      "missing due date",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, dueDate: undefined } },
    ],
    [
      "unknown add milestone key",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: { ...add, extra: 1 } },
    ],
    [
      "bad contract id on finish",
      "post",
      `${base}/nope/finish`,
      "client",
      { body: finish },
    ],
    [
      "string rating",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, rating: "5" } },
    ],
    [
      "rating above range",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, rating: 6 } },
    ],
    [
      "fractional rating",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, rating: 4.5 } },
    ],
    [
      "short comment",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, comment: "short" } },
    ],
    [
      "oversized comment",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, comment: "x".repeat(1001) } },
    ],
    [
      "invalid scope on finish",
      "post",
      `${base}/${id}/finish`,
      "freelancer",
      { query: { scope: "x" }, body: finish },
    ],
    [
      "unknown finish key",
      "post",
      `${base}/${id}/finish`,
      "client",
      { body: { ...finish, extra: 1 } },
    ],
  ] as const)(
    "returns 400 VALIDATION_ERROR for %s",
    async (_name, method, path, role, input) => {
      const response = await call(method, path, role, input as Input);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(response.body.success).toBe(false);
    },
  );

  it.each([
    ["client list", "get", `${base}/client`, "client", {}],
    ["freelancer list", "get", `${base}/freelancer`, "freelancer", {}],
    [
      "agency list",
      "get",
      `${base}/freelancer`,
      "freelancer",
      { query: { scope: "agency" } },
    ],
    ["accept", "patch", `${base}/${id}/accept`, "freelancer", {}],
    ["submit", "patch", `${milestone}/submit`, "freelancer", { body: submit }],
    [
      "submit with link",
      "patch",
      `${milestone}/submit`,
      "freelancer",
      { body: { ...submit, submissionDeliveryLink: "https://a.test/x" } },
    ],
    ["approve", "patch", `${milestone}/review`, "client", { body: review }],
    [
      "request changes",
      "patch",
      `${milestone}/review`,
      "client",
      { body: { action: "REQUEST_CHANGES", feedback: "Fix it" } },
    ],
    [
      "checkout",
      "post",
      `${base}/checkout`,
      "client",
      { body: { proposalId: id } },
    ],
    [
      "milestone checkout without body",
      "post",
      `${milestone}/checkout`,
      "client",
      {},
    ],
    [
      "milestone checkout with requirements",
      "post",
      `${milestone}/checkout`,
      "client",
      { body: { requirements: "Details" } },
    ],
    [
      "add milestone",
      "post",
      `${base}/${id}/milestones`,
      "client",
      { body: add },
    ],
    ["finish", "post", `${base}/${id}/finish`, "client", { body: finish }],
    [
      "agency finish",
      "post",
      `${base}/${id}/finish`,
      "freelancer",
      { query: { scope: "agency" }, body: finish },
    ],
  ] as const)("passes validation for a valid %s", async (...args) => {
    const [, method, path, role, input] = args;
    const response = await call(method, path, role, input as Input);

    expect(response.status).not.toBe(400);
  });

  it("returns 403 for a valid review by a freelancer", async () => {
    const response = await call("patch", `${milestone}/review`, "freelancer", {
      body: review,
    });

    expect(response.status).toBe(403);
  });

  it("returns 400 before 403 for an invalid review by a freelancer", async () => {
    const response = await call("patch", `${milestone}/review`, "freelancer", {
      body: {},
    });

    expect(response.status).toBe(400);
  });
});
