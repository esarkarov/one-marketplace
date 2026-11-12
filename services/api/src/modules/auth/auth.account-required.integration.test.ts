import { randomUUID } from "node:crypto";
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
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/env.js")>();
  return { ...original, env: { ...original.env, clerkSecretKey: "sk_test" } };
});

vi.mock("../../infrastructure/clerk.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: mocks.verifyToken,
}));

vi.mock("../../infrastructure/redis.js", () => ({
  redis: {
    get: async (key: string) => mocks.store.get(key) ?? null,
    expire: async () => true,
    setEx: async (key: string, _ttl: number, value: string) => {
      mocks.store.set(key, value);
      return "OK";
    },
    del: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        mocks.store.delete(key);
      }
      return 1;
    },
  },
  connectRedis: async () => undefined,
  disconnectRedis: async () => undefined,
}));

import { db, pool } from "../../database/client.js";
import { accounts } from "../../database/schema.js";
import { assertTestDatabase } from "../../test/assert-test-database.js";
import { authenticateHandshake } from "../messaging/messaging.socket.js";

const { app } = await import("../../app.js");

const PREFIX = "auth-it-";
const bearer = { Authorization: "Bearer test-token" };

const newAuthId = () => `${PREFIX}${randomUUID()}`;

const signInAs = (userId: string) =>
  mocks.verifyToken.mockResolvedValue({ sub: userId, sid: "sess_1" });

const insertAccount = async (authId: string, role: "CLIENT" | "FREELANCER") => {
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role,
    created_at: new Date(),
    updated_at: new Date(),
  });
};

const purge = () =>
  pool.query("delete from accounts where auth_id like $1", [`${PREFIX}%`]);

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

beforeEach(() => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  mocks.store.clear();
  mocks.verifyToken.mockReset();
  mocks.getUser.mockReset();
});

describe("claimed role requires an account", () => {
  it("answers 403 when no account exists for the claimed role", async () => {
    const userId = newAuthId();
    await insertAccount(userId, "CLIENT");
    signInAs(userId);

    const response = await request(app)
      .get("/api/v1/freelancer/profile")
      .query({ role: "freelancer" })
      .set(bearer);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: "An account for this role is required.",
    });
  });

  it("answers 403 when the user has no account at all", async () => {
    signInAs(newAuthId());

    const response = await request(app)
      .get("/api/v1/client/profile")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(403);
  });

  it("answers 200 for the user's own role", async () => {
    const userId = newAuthId();
    await insertAccount(userId, "CLIENT");
    signInAs(userId);

    const response = await request(app)
      .get("/api/v1/client/profile")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(200);
  });
});

describe("GET /auth/status", () => {
  it("answers 200 with accountExists false for a user without an account", async () => {
    signInAs(newAuthId());

    const response = await request(app)
      .get("/api/v1/auth/status")
      .query({ role: "client" })
      .set(bearer);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      role: "client",
      accountExists: false,
      isOnboarded: false,
    });
  });
});

describe("POST /auth/sign-up", () => {
  it("creates the account and the next authenticated call is not 403", async () => {
    const userId = newAuthId();
    signInAs(userId);
    mocks.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: `${userId}@example.test` },
      emailAddresses: [],
    });

    const status = await request(app)
      .get("/api/v1/auth/status")
      .query({ role: "client" })
      .set(bearer);
    expect(status.body.data.accountExists).toBe(false);

    const signup = await request(app)
      .post("/api/v1/auth/sign-up")
      .set(bearer)
      .send({ role: "client" });
    expect(signup.status).toBe(201);

    const profile = await request(app)
      .get("/api/v1/client/profile")
      .query({ role: "client" })
      .set(bearer);
    expect(profile.status).toBe(200);
  });
});

describe("socket handshake", () => {
  it("rejects a handshake without an account for the role", async () => {
    signInAs(newAuthId());

    await expect(
      authenticateHandshake({ token: "test-token", role: "client" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("accepts a handshake for an existing account", async () => {
    const userId = newAuthId();
    await insertAccount(userId, "FREELANCER");
    signInAs(userId);

    await expect(
      authenticateHandshake({ token: "test-token", role: "freelancer" }),
    ).resolves.toMatchObject({ userId, accountExists: true });
  });
});
