import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  verifyToken: vi.fn(),
  accountRows: [] as unknown[],
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));

vi.mock("../config/imageKit.js", () => ({
  imageKit: { files: { upload: mocks.upload, delete: mocks.remove } },
}));

vi.mock("../config/redis.js", () => ({
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

vi.mock("../database/client.js", () => {
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

const { app } = await import("../app.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const bearer = { Authorization: "Bearer test-token" };

const dataUrl = (type: string, content: string | Buffer) =>
  `data:${type};base64,${Buffer.from(content).toString("base64")}`;

const dueDate = new Date(Date.now() + 86_400_000 * 30).toISOString();

const jobBody = (attachment: Record<string, unknown>) => ({
  role: "client",
  title: "Build a site",
  description: "Details",
  expertise_level: "Expert",
  expected_duration: "1 month",
  skills: ["react"],
  milestones: [{ title: "M1", budget: 100, dueDate }],
  attachments: [{ fileName: "a.pdf", fileSize: 1, ...attachment }],
});

const messageBody = (attachment: Record<string, unknown>) => ({
  role: "freelancer",
  attachments: [{ fileName: "a.txt", fileSize: 1, ...attachment }],
});

const send = (method: "post" | "put", path: string, body: unknown) =>
  request(app)
    [method](path)
    .set(bearer)
    .send(body as object);

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [{ isOnboardingComplete: true }];
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("POST /api/v1/jobs attachment validation", () => {
  it.each([
    [
      "a foreign URL",
      { fileUrl: "https://evil.example/a.pdf", fileType: "application/pdf" },
      "Attachment URL is not allowed.",
    ],
    [
      "a javascript URL",
      { fileUrl: "javascript:alert(1)", fileType: "application/pdf" },
      "Attachment URL is not allowed.",
    ],
    [
      "an svg data URL",
      {
        fileUrl: dataUrl("image/svg+xml", "<svg></svg>"),
        fileType: "image/svg+xml",
      },
      "Attachment type is not allowed.",
    ],
    [
      "html content declared as text/plain",
      {
        fileUrl: dataUrl("text/plain", "<html><script>x</script></html>"),
        fileType: "text/plain",
      },
      "Attachment type is not allowed.",
    ],
    [
      "PNG bytes declared as PDF",
      {
        fileUrl: dataUrl("application/pdf", "\x89PNG\r\n\x1a\n0000"),
        fileType: "application/pdf",
      },
      "Attachment content does not match its file type.",
    ],
  ])(
    "returns 400 for %s without reaching ImageKit",
    async (_n, att, message) => {
      const response = await send("post", "/api/v1/jobs", jobBody(att));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(message);
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("returns 400 for a path separator in the file name", async () => {
    const response = await send(
      "post",
      "/api/v1/jobs",
      jobBody({
        fileName: "../a.pdf",
        fileUrl: dataUrl("application/pdf", "%PDF-1.4"),
        fileType: "application/pdf",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Attachment name is invalid.");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/conversations/:id/messages attachment validation", () => {
  const path = `/api/v1/conversations/${id}/messages`;

  it.each([
    [
      "an html data URL",
      {
        fileUrl: dataUrl("text/html", "<html></html>"),
        mimeType: "text/html",
      },
      "Attachment type is not allowed.",
    ],
    [
      "a spoofed type",
      {
        fileUrl: dataUrl("text/plain", "<script>alert(1)</script>"),
        mimeType: "text/plain",
      },
      "Attachment type is not allowed.",
    ],
    [
      "a header type that differs from the declared type",
      {
        fileUrl: dataUrl("text/plain", "hello"),
        mimeType: "application/pdf",
      },
      "Attachment content does not match its file type.",
    ],
    [
      "a remote URL",
      { fileUrl: "https://evil.example/a.txt", mimeType: "text/plain" },
      "Attachment file is invalid.",
    ],
  ])(
    "returns 400 for %s without reaching ImageKit",
    async (_n, att, message) => {
      const response = await send("post", path, messageBody(att));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(message);
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
});

describe("large routes require an account for the claimed role", () => {
  it.each([
    ["post", "/api/v1/jobs", "client"],
    ["put", `/api/v1/jobs/${id}`, "client"],
    ["post", `/api/v1/conversations/${id}/messages`, "freelancer"],
    ["put", "/api/v1/freelancer/profile", "freelancer"],
    ["put", "/api/v1/agency", "client"],
  ] as const)(
    "%s %s returns 403 without an account row",
    async (method, path, role) => {
      mocks.accountRows = [];

      const response = await send(method, path, {
        role,
        attachments: [
          {
            fileName: "a.txt",
            fileSize: 1,
            fileType: "text/plain",
            mimeType: "text/plain",
            fileUrl: dataUrl("text/plain", "hello"),
          },
        ],
      });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        message: "An account for this role is required.",
      });
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
});
