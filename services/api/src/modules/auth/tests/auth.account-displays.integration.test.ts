import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(() => {
    throw new Error("Clerk must not be called by findAccountDisplays");
  }),
}));

vi.mock("../../../infrastructure/auth/clerk.client.js", () => ({
  clerk: { users: { getUser: mocks.getUser } },
  verifyToken: vi.fn(),
}));

import { db, pool } from "../../../database/client.js";
import { accounts } from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { findAccountDisplays } from "../services/auth.display.service.js";

const PREFIX = "disp-batch3-it-";

const purge = async () => {
  await pool.query("delete from accounts where auth_id like $1", [
    `${PREFIX}%`,
  ]);
};

const insertAccount = async (
  display: { display_name?: string | null; avatar_url?: string | null } = {},
) => {
  const authId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: authId,
    email: `${authId}@example.test`,
    role: "FREELANCER",
    ...display,
  });
  return authId;
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(mocks.getUser).not.toHaveBeenCalled();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

describe("findAccountDisplays", () => {
  it("returns the stored name and avatar for every id in one query", async () => {
    const named = await insertAccount({
      display_name: "Ada Lovelace",
      avatar_url: "https://img.test/ada.png",
    });
    const bare = await insertAccount();
    const query = vi.spyOn(pool, "query");

    const displays = await findAccountDisplays([named, bare]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(displays.size).toBe(2);
    expect(displays.get(named)).toEqual({
      displayName: "Ada Lovelace",
      avatarUrl: "https://img.test/ada.png",
    });
    expect(displays.get(bare)).toEqual({ displayName: null, avatarUrl: null });
  });

  it("deduplicates repeated ids before querying", async () => {
    const authId = await insertAccount({ display_name: "Grace Hopper" });
    const query = vi.spyOn(pool, "query");

    const displays = await findAccountDisplays([authId, authId, authId]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([authId]);
    expect([...displays.keys()]).toEqual([authId]);
  });

  it("returns an empty map for empty input without querying", async () => {
    const query = vi.spyOn(pool, "query");

    const displays = await findAccountDisplays([]);

    expect(displays.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves ids without an account out of the map", async () => {
    const known = await insertAccount({ display_name: "Known" });
    const missing = `${PREFIX}${randomUUID()}`;

    const displays = await findAccountDisplays([known, missing]);

    expect(displays.has(missing)).toBe(false);
    expect(displays.get(known)?.displayName).toBe("Known");
  });

  it("serves only the requested accounts", async () => {
    const wanted = await insertAccount({ display_name: "Wanted" });
    await insertAccount({ display_name: "Bystander" });

    const displays = await findAccountDisplays([wanted]);

    expect([...displays.keys()]).toEqual([wanted]);
  });

  it("reads the current stored values, not a cached copy", async () => {
    const authId = await insertAccount({ display_name: "Before" });
    expect((await findAccountDisplays([authId])).get(authId)?.displayName).toBe(
      "Before",
    );

    await pool.query(
      "update accounts set display_name = $2, avatar_url = $3 where auth_id = $1",
      [authId, "After", "https://img.test/after.png"],
    );

    expect(await findAccountDisplays([authId])).toEqual(
      new Map([
        [
          authId,
          { displayName: "After", avatarUrl: "https://img.test/after.png" },
        ],
      ]),
    );
  });
});
