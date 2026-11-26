import { randomUUID } from "node:crypto";
import express from "express";
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

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failing: new Set<string>(),
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("@/infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("@/infrastructure/cache/redis.client.js", () => ({
  redis: {
    get: async (key: string) => {
      if (mocks.failing.has("get")) throw new Error("redis get failed");
      return mocks.store.get(key) ?? null;
    },
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      if (mocks.failing.has("setEx")) throw new Error("redis setEx failed");
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (keys: string | string[]) => {
      if (mocks.failing.has("del")) throw new Error("redis del failed");
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mocks.store.delete(key);
      }
      return 1;
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

import { db, pool } from "@/database/client.js";
import { accounts } from "@/test/support/tables.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { getAccountAuthCacheKey } from "@/infrastructure/utils/account-auth-cache-key.utils.js";
import {
  authStatusResponses,
  signUpResponses,
} from "@/modules/auth/responses/auth.responses.js";

const { app } = await import("@/app.js");
const { isAuthenticated } =
  await import("@/modules/auth/middleware/auth.middleware.js");
const { errorHandler } = await import("@/middleware/error/error.middleware.js");

const PREFIX = "auth-redis-fail-open-";
const API = "/api/v1/auth";
const bearer = { Authorization: "Bearer test-token" };

const protectedApp = express();
protectedApp.get("/protected", isAuthenticated, (request, response) => {
  response.json({
    accountId: request.auth?.accountId ?? null,
    accountExists: request.auth?.accountExists ?? false,
  });
});
protectedApp.use(errorHandler);

const purge = () =>
  pool.query("delete from accounts where auth_id like $1", [`${PREFIX}%`]);

const insertAccount = async (role: "CLIENT" | "FREELANCER") => {
  const authId = `${PREFIX}${randomUUID()}`;
  const [row] = await db
    .insert(accounts)
    .values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning({ id: accounts.id });
  return { authId, accountId: row!.id };
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  mocks.store.clear();
  mocks.failing.clear();
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
});

describe("authentication while Redis fails", () => {
  it.each([["get"], ["setEx"], ["get", "setEx"]])(
    "an isAuthenticated route reads the account from the database when %s rejects",
    async (...operations: string[]) => {
      const { authId, accountId } = await insertAccount("FREELANCER");
      mocks.verifyToken.mockResolvedValue({ sub: authId, sid: "sess_1" });
      for (const operation of operations) mocks.failing.add(operation);

      const response = await request(protectedApp)
        .get("/protected")
        .query({ role: "freelancer" })
        .set(bearer);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ accountId, accountExists: true });
    },
  );

  it("still refuses an account that does not exist in the database when get rejects", async () => {
    mocks.verifyToken.mockResolvedValue({
      sub: `${PREFIX}${randomUUID()}`,
      sid: "sess_1",
    });
    mocks.failing.add("get");

    const response = await request(protectedApp)
      .get("/protected")
      .query({ role: "freelancer" })
      .set(bearer);

    expect(response.status).toBe(403);
  });

  it("treats an unreadable cached entry as a miss and reads the database", async () => {
    const { authId, accountId } = await insertAccount("CLIENT");
    mocks.verifyToken.mockResolvedValue({ sub: authId, sid: "sess_1" });
    mocks.store.set(getAccountAuthCacheKey(authId, "client"), "{not json");

    const response = await request(protectedApp)
      .get("/protected")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accountId, accountExists: true });
  });

  it("GET /auth/status answers 200 with the stored account when get rejects", async () => {
    const { authId, accountId } = await insertAccount("CLIENT");
    mocks.verifyToken.mockResolvedValue({ sub: authId, sid: "sess_1" });
    mocks.failing.add("get");
    mocks.failing.add("setEx");

    const status = await request(app)
      .get(`${API}/status`)
      .query({ role: "client" })
      .set(bearer);

    expect(status.status).toBe(200);
    const body = authStatusResponses[200].parse(status.body);
    expect(body.data.accountExists).toBe(true);
    expect(body.data.accountId).toBe(accountId);
  });

  it("POST /sign-up answers 201 instead of 401 when get and setEx reject", async () => {
    const userId = `${PREFIX}${randomUUID()}`;
    mocks.verifyToken.mockResolvedValue({ sub: userId, sid: "sess_1" });
    mocks.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: `${userId}@example.test` },
      emailAddresses: [],
    });
    mocks.failing.add("get");
    mocks.failing.add("setEx");
    mocks.failing.add("del");

    const signup = await request(app)
      .post(`${API}/sign-up`)
      .set(bearer)
      .send({ role: "client" });

    expect(signup.status).toBe(201);
    signUpResponses[201].parse(signup.body);
    const { rows } = await pool.query(
      "select id from accounts where auth_id = $1",
      [userId],
    );
    expect(signup.body.data.accountId).toBe(rows[0].id);
  });
});
