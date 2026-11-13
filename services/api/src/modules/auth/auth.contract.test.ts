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

import { pool } from "../../database/client.js";
import { assertTestDatabase } from "../../test/setup/assert-test-database.js";
import { authStatusResponses, signUpResponses } from "./auth.responses.js";

const { app } = await import("../../app.js");
const { receiveSignup } = await import("./auth.service.js");

const PREFIX = "auth-contract-";
const API = "/api/v1/auth";

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

describe("auth contract", () => {
  it("POST /sign-up matches the 201 schema and GET /status the 200 schema", async () => {
    const userId = `${PREFIX}${randomUUID()}`;
    mocks.verifyToken.mockResolvedValue({ sub: userId, sid: "sess_1" });
    mocks.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: `${userId}@example.test` },
      emailAddresses: [],
    });
    const bearer = { Authorization: "Bearer test-token" };

    const signup = await request(app)
      .post(`${API}/sign-up`)
      .set(bearer)
      .send({ role: "client" });
    expect(signup.status).toBe(201);
    signUpResponses[201].parse(signup.body);

    const status = await request(app)
      .get(`${API}/status`)
      .query({ role: "client" })
      .set(bearer);
    expect(status.status).toBe(200);
    authStatusResponses[200].parse(status.body);
    expect(status.body.data.accountExists).toBe(true);
  });

  it("POST /sign-up stores the requested role, the Clerk email and unverified defaults", async () => {
    const userId = `${PREFIX}${randomUUID()}`;
    const email = `${userId}@example.test`;
    mocks.verifyToken.mockResolvedValue({ sub: userId, sid: "sess_1" });
    mocks.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: email },
      emailAddresses: [],
    });

    const signup = await request(app)
      .post(`${API}/sign-up`)
      .set({ Authorization: "Bearer test-token" })
      .send({ role: "freelancer" });
    expect(signup.status).toBe(201);

    const { rows } = await pool.query(
      `select email, role, "identityVerified", "isOnboardingComplete", created_at, updated_at from accounts where auth_id = $1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(email);
    expect(rows[0].role).toBe("FREELANCER");
    expect(rows[0].identityVerified).toBe(false);
    expect(rows[0].isOnboardingComplete).toBe(false);
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect(rows[0].updated_at).toBeInstanceOf(Date);
  });

  it("receiveSignup leaves an existing account untouched when the insert conflicts", async () => {
    const userId = `${PREFIX}${randomUUID()}`;
    await pool.query(
      `insert into accounts (auth_id, email, role) values ($1, $2, 'FREELANCER')`,
      [userId, "original@example.test"],
    );
    mocks.getUser.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "other@example.test" },
      emailAddresses: [],
    });

    await expect(
      receiveSignup({
        userId,
        role: "client",
        accountExists: false,
        isOnboarded: false,
      }),
    ).resolves.toBeUndefined();

    const { rows } = await pool.query(
      "select email, role from accounts where auth_id = $1",
      [userId],
    );
    expect(rows).toEqual([
      { email: "original@example.test", role: "FREELANCER" },
    ]);
  });
});
