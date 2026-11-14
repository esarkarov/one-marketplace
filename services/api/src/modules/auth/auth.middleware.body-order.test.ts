import express from "express";
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
const { isAuthenticated, resolveAccountRole, verifyBearerToken } =
  await import("./auth.middleware.js");
const { errorHandler } =
  await import("../../app-middleware/error.middleware.js");

const id = "123e4567-e89b-42d3-a456-426614174000";
const bearer = { Authorization: "Bearer test-token" };
const invalidJson = "{bad";

const largeRoutes = [
  ["post", "/api/v1/jobs"],
  ["put", `/api/v1/jobs/${id}`],
  ["post", `/api/v1/conversations/${id}/messages`],
  ["put", "/api/v1/freelancer/profile"],
  ["put", "/api/v1/agency"],
] as const;

const sendJson = (
  method: (typeof largeRoutes)[number][0],
  path: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  request(app)
    [method](path)
    .set({ "Content-Type": "application/json", ...headers })
    .send(body);

beforeEach(() => {
  mocks.store.clear();
  mocks.accountRows = [];
  mocks.verifyToken.mockReset();
  mocks.verifyToken.mockResolvedValue({ sub: "user_1", sid: "sess_1" });
});

describe("large JSON routes parse the body after authentication", () => {
  it.each(largeRoutes)(
    "%s %s returns 401 for an invalid body without a token",
    async (method, path) => {
      const response = await sendJson(method, path, invalidJson);

      expect(response.status).toBe(401);
      expect(mocks.verifyToken).not.toHaveBeenCalled();
    },
  );

  it.each(largeRoutes)(
    "%s %s returns 401 for an invalid body with a rejected token",
    async (method, path) => {
      mocks.verifyToken.mockRejectedValue(new Error("bad token"));

      const response = await sendJson(method, path, invalidJson, bearer);

      expect(response.status).toBe(401);
    },
  );

  it.each(largeRoutes)(
    "%s %s returns 400 for an invalid body with a valid token",
    async (method, path) => {
      const response = await sendJson(method, path, invalidJson, bearer);

      expect(response.status).toBe(400);
      expect(mocks.verifyToken).toHaveBeenCalledOnce();
    },
  );
});

describe("body size limits", () => {
  it("does not reject a 1 MB body with 413 on a large route", async () => {
    const body = JSON.stringify({
      role: "client",
      filler: "x".repeat(1_000_000),
    });

    const response = await sendJson("post", "/api/v1/jobs", body, bearer);

    expect(response.status).not.toBe(413);
  });

  it("rejects a 200 KB body with 413 on a default-limit route", async () => {
    const body = JSON.stringify({
      role: "client",
      filler: "x".repeat(200_000),
    });

    const response = await request(app)
      .post("/api/v1/proposals")
      .set({ "Content-Type": "application/json", ...bearer })
      .send(body);

    expect(response.status).toBe(413);
  });
});

describe("messaging routes other than posting messages require auth", () => {
  it.each([
    ["get", "/api/v1/conversations"],
    ["post", "/api/v1/conversations"],
    ["get", `/api/v1/conversations/${id}/messages`],
    ["post", `/api/v1/conversations/${id}/read`],
    ["post", `/api/v1/conversations/${id}/meetings`],
  ] as const)("%s %s returns 401 without a token", async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
  });
});

const buildSplitApp = () => {
  const split = express();
  split.use(express.json());
  split.post("/echo", verifyBearerToken, resolveAccountRole, (req, res) => {
    res.json({ auth: req.auth, claims: req.authClaims });
  });
  split.use(errorHandler);
  return split;
};

describe("verifyBearerToken and resolveAccountRole", () => {
  it("returns 403 when the lookup finds no account for the role", async () => {
    const response = await request(buildSplitApp())
      .post("/echo")
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("An account for this role is required.");
  });

  it("takes accountExists and isOnboarded from the lookup only", async () => {
    mocks.accountRows = [{ isOnboardingComplete: true }];

    const response = await request(buildSplitApp())
      .post("/echo")
      .set(bearer)
      .send({ role: "freelancer", accountExists: false, isOnboarded: false });

    expect(response.body.auth).toMatchObject({
      role: "freelancer",
      accountExists: true,
      isOnboarded: true,
    });
  });

  it("reads the role from the query when the body has none", async () => {
    mocks.accountRows = [{ isOnboardingComplete: false }];

    const response = await request(buildSplitApp())
      .post("/echo?role=freelancer")
      .set(bearer)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.auth.role).toBe("freelancer");
  });

  it.each([{}, { role: "admin" }, { role: 5 }])(
    "returns 400 for an invalid role %j",
    async (payload) => {
      const response = await request(buildSplitApp())
        .post("/echo")
        .set(bearer)
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("A valid account role is required.");
    },
  );

  it("returns 401 for a missing token", async () => {
    const response = await request(buildSplitApp())
      .post("/echo")
      .send({ role: "client" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Please do login to access this API!");
  });

  it("returns 401 for an invalid token before reading the role", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("bad token"));

    const response = await request(buildSplitApp())
      .post("/echo")
      .set(bearer)
      .send({ role: "nope" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(
      "Authentication token is invalid or expired.",
    );
  });
});

describe("isAuthenticated error order", () => {
  const buildApp = () => {
    const single = express();
    single.use(express.json());
    single.post("/check", isAuthenticated, (req, res) => {
      res.json({ auth: req.auth });
    });
    single.use(errorHandler);
    return single;
  };

  it("returns 401 for a missing token even with an invalid role", async () => {
    const response = await request(buildApp())
      .post("/check")
      .send({ role: "nope" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Please do login to access this API!");
  });

  it("returns 400 for an invalid role before checking the token", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("bad token"));

    const response = await request(buildApp())
      .post("/check")
      .set(bearer)
      .send({ role: "nope" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("A valid account role is required.");
  });

  it("returns 401 for an invalid token with a valid role", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("bad token"));

    const response = await request(buildApp())
      .post("/check")
      .set(bearer)
      .send({ role: "client" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(
      "Authentication token is invalid or expired.",
    );
  });

  it("sets request.auth from the lookup", async () => {
    mocks.accountRows = [{ isOnboardingComplete: true }];

    const response = await request(buildApp())
      .post("/check")
      .set(bearer)
      .send({ role: "client" });

    expect(response.body.auth).toEqual({
      userId: "user_1",
      sessionId: "sess_1",
      role: "client",
      accountExists: true,
      isOnboarded: true,
    });
  });
});
