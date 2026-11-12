import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { app } from "./app.js";
import { getAccountAuthCacheKey } from "./config/constants.js";
import {
  connectRedis,
  disconnectRedis,
  redis,
} from "./infrastructure/redis.js";
import { pool } from "./database/client.js";

const clerk = vi.hoisted(() => ({ verifyToken: vi.fn() }));

vi.mock("@clerk/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/backend")>()),
  verifyToken: clerk.verifyToken,
}));

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectRedis();
  await pool.end();
});

describe("health and readiness", () => {
  it("reports healthy", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("healthy");
  });

  it("reports ready when postgres and redis are up", async () => {
    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.checks).toEqual({ postgres: "ok", redis: "ok" });
  });

  it("reports not ready without leaking error details", async () => {
    vi.spyOn(pool, "query").mockRejectedValueOnce(
      new Error("secret-connection-detail"),
    );

    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(503);
    expect(response.body.data.checks.postgres).toBe("failed");
    expect(response.text).not.toContain("secret-connection-detail");
  });
});

beforeEach(() => {
  clerk.verifyToken.mockReset();
  clerk.verifyToken.mockRejectedValue(new Error("invalid token"));
});

describe("authentication", () => {
  it("rejects requests without a token", async () => {
    const response = await request(app).get("/api/v1/jobs");

    expect(response.status).toBe(401);
  });
});

describe("cors", () => {
  it.each([
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
  ])("allows %s without credentials", async (origin) => {
    const response = await request(app)
      .get("/api/v1/health")
      .set("Origin", origin);

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(
      response.headers["access-control-allow-credentials"],
    ).toBeUndefined();

    const preflight = await request(app)
      .options("/api/v1/jobs")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "GET");

    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(
      preflight.headers["access-control-allow-credentials"],
    ).toBeUndefined();
  });

  it.each(["http://localhost:3000", "http://evil.example"])(
    "does not allow %s",
    async (origin) => {
      const response = await request(app)
        .get("/api/v1/health")
        .set("Origin", origin);

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it("serves requests without an origin", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
  });
});

describe("helmet", () => {
  it("sets security headers", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "cross-origin",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("body limits", () => {
  it("rejects a large body on a default route", async () => {
    const response = await request(app)
      .post("/api/v1/proposals")
      .send({ data: "a".repeat(200 * 1024) });

    expect(response.status).toBe(413);
  });

  it("accepts and parses a large body on an exception route", async () => {
    const userId = "app_test_large_body_user";
    clerk.verifyToken.mockResolvedValueOnce({ sub: userId, sid: "sess" });

    try {
      const response = await request(app)
        .post("/api/v1/jobs")
        .set("Authorization", "Bearer test-token")
        .send({ role: "client", data: "a".repeat(1024 * 1024) });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(
        "An account for this role is required.",
      );
    } finally {
      await redis.del(getAccountAuthCacheKey(userId, "client"));
    }
  });
});
