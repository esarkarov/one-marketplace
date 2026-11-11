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
const base = "/api/v1/conversations";
const messages = `${base}/${id}/messages`;

const attachment = {
  fileName: "a.txt",
  fileSize: 5,
  mimeType: "text/plain",
  fileUrl: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`,
};

type Method = "get" | "post";
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

describe("messaging authentication and role order", () => {
  it.each([
    ["get", base],
    ["post", base],
    ["post", messages],
    ["get", messages],
    ["post", `${base}/${id}/read`],
    ["post", `${base}/${id}/meetings`],
    ["post", `${base}/nope/meetings`],
  ] as const)("%s %s returns 401 before 400", async (method, path) => {
    const response = await request(app)[method](path).send({ junk: true });

    expect(response.status).toBe(401);
  });

  it("returns 403 before 400 on messages without an account", async () => {
    mocks.accountRows = [];

    const response = await call("post", `${base}/nope/messages`, "freelancer", {
      body: { extra: 1 },
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 for a freelancer opening a conversation", async () => {
    const response = await call("post", base, "freelancer", {
      body: { recipientId: "user_2" },
    });

    expect(response.status).toBe(403);
  });
});

describe("messaging request validation", () => {
  it.each([
    [
      "invalid scope on list",
      "get",
      base,
      "client",
      { query: { scope: "team" } },
    ],
    ["unknown query on list", "get", base, "client", { query: { extra: "1" } }],
    [
      "unknown key on open",
      "post",
      base,
      "client",
      { body: { recipientId: "u", extra: 1 } },
    ],
    [
      "oversized recipient",
      "post",
      base,
      "client",
      { body: { recipientId: "x".repeat(65) } },
    ],
    ["numeric recipient", "post", base, "client", { body: { recipientId: 5 } }],
    [
      "bad job id on open",
      "post",
      base,
      "client",
      { body: { recipientId: "u", jobId: "nope" } },
    ],
    [
      "bad proposal id on open",
      "post",
      base,
      "client",
      { body: { proposalId: "nope" } },
    ],
    [
      "bad conversation id on send",
      "post",
      `${base}/nope/messages`,
      "client",
      { body: { body: "hi" } },
    ],
    [
      "oversized message",
      "post",
      messages,
      "client",
      { body: { body: "x".repeat(10_001) } },
    ],
    ["non-string message", "post", messages, "client", { body: { body: 5 } }],
    [
      "unknown send key",
      "post",
      messages,
      "client",
      { body: { body: "hi", extra: 1 } },
    ],
    [
      "too many attachments",
      "post",
      messages,
      "client",
      { body: { attachments: Array(6).fill(attachment) } },
    ],
    [
      "attachments not an array",
      "post",
      messages,
      "client",
      { body: { attachments: "x" } },
    ],
    [
      "attachment missing file name",
      "post",
      messages,
      "client",
      {
        body: {
          attachments: [{ ...attachment, fileName: undefined }],
        },
      },
    ],
    [
      "attachment oversized file name",
      "post",
      messages,
      "client",
      {
        body: {
          attachments: [{ ...attachment, fileName: `${"x".repeat(256)}.txt` }],
        },
      },
    ],
    [
      "attachment fractional size",
      "post",
      messages,
      "client",
      { body: { attachments: [{ ...attachment, fileSize: 1.5 }] } },
    ],
    [
      "attachment unknown key",
      "post",
      messages,
      "client",
      { body: { attachments: [{ ...attachment, extra: 1 }] } },
    ],
    [
      "attachment oversized file",
      "post",
      messages,
      "client",
      {
        body: {
          attachments: [{ ...attachment, fileUrl: "x".repeat(7_000_000) }],
        },
      },
    ],
    [
      "bad reply id",
      "post",
      messages,
      "client",
      { body: { body: "hi", replyToMessageId: "nope" } },
    ],
    [
      "bad conversation id on messages list",
      "get",
      `${base}/nope/messages`,
      "client",
      {},
    ],
    [
      "non-numeric limit",
      "get",
      messages,
      "client",
      { query: { limit: "abc" } },
    ],
    ["negative limit", "get", messages, "client", { query: { limit: "-5" } }],
    [
      "oversized cursor",
      "get",
      messages,
      "client",
      { query: { cursor: "x".repeat(513) } },
    ],
    ["repeated cursor", "get", `${messages}?cursor=a&cursor=b`, "client", {}],
    [
      "unknown messages query",
      "get",
      messages,
      "client",
      { query: { extra: "1" } },
    ],
    [
      "bad conversation id on read",
      "post",
      `${base}/nope/read`,
      "client",
      {
        body: { lastReadMessageId: id },
      },
    ],
    [
      "missing last read id",
      "post",
      `${base}/${id}/read`,
      "client",
      { body: {} },
    ],
    [
      "bad last read id",
      "post",
      `${base}/${id}/read`,
      "client",
      { body: { lastReadMessageId: "nope" } },
    ],
    [
      "unknown read key",
      "post",
      `${base}/${id}/read`,
      "client",
      { body: { lastReadMessageId: id, extra: 1 } },
    ],
    [
      "bad conversation id on meeting",
      "post",
      `${base}/nope/meetings`,
      "client",
      {},
    ],
    [
      "unknown meeting query",
      "post",
      `${base}/${id}/meetings`,
      "client",
      { query: { extra: "1" } },
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
    ["list", "get", base, "client", {}],
    ["agency list", "get", base, "freelancer", { query: { scope: "agency" } }],
    ["open", "post", base, "client", { body: { recipientId: "user_2" } }],
    [
      "open with ids",
      "post",
      base,
      "client",
      { body: { recipientId: "u", jobId: id, proposalId: "" } },
    ],
    ["text message", "post", messages, "client", { body: { body: "hi" } }],
    [
      "attachment message",
      "post",
      messages,
      "client",
      { body: { attachments: [attachment] } },
    ],
    [
      "reply message",
      "post",
      messages,
      "freelancer",
      { body: { body: "hi", replyToMessageId: id } },
    ],
    ["messages list", "get", messages, "client", { query: { limit: "20" } }],
    [
      "mark read",
      "post",
      `${base}/${id}/read`,
      "client",
      { body: { lastReadMessageId: id } },
    ],
    ["meeting", "post", `${base}/${id}/meetings`, "client", {}],
  ] as const)("passes validation for a valid %s", async (...args) => {
    const [, method, path, role, input] = args;
    const response = await call(method, path, role, input as Input);

    expect(response.status).not.toBe(400);
  });

  it("returns 400 before 403 for an invalid open by a freelancer", async () => {
    const response = await call("post", base, "freelancer", {
      body: { extra: 1 },
    });

    expect(response.status).toBe(400);
  });
});
