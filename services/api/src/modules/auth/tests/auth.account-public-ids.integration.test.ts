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
import { db, pool } from "../../../database/client.js";
import { accounts } from "../../../test/support/tables.js";
import { assertTestDatabase } from "../../../test/setup/assert-test-database.js";
import { findAccountPublicIds } from "../repositories/auth.repository.js";

const PREFIX = "auth-pubid-it-";

const purge = async () => {
  await pool.query("delete from accounts where auth_id like $1", [
    `${PREFIX}%`,
  ]);
};

const insertAccount = async () => {
  const authId = `${PREFIX}${randomUUID()}`;
  const [row] = await db
    .insert(accounts)
    .values({
      auth_id: authId,
      email: `${authId}@example.test`,
      role: "FREELANCER",
    })
    .returning({ id: accounts.id });
  return { authId, id: row!.id };
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await purge();
  await pool.end();
});

describe("findAccountPublicIds", () => {
  it("maps every auth id to its public account id in one query", async () => {
    const first = await insertAccount();
    const second = await insertAccount();
    const query = vi.spyOn(pool, "query");

    const ids = await findAccountPublicIds(db, [first.authId, second.authId]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(ids.size).toBe(2);
    expect(ids.get(first.authId)).toBe(first.id);
    expect(ids.get(second.authId)).toBe(second.id);
  });

  it("deduplicates repeated ids before querying", async () => {
    const account = await insertAccount();
    const query = vi.spyOn(pool, "query");

    const ids = await findAccountPublicIds(db, [
      account.authId,
      account.authId,
      account.authId,
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([account.authId]);
    expect([...ids.entries()]).toEqual([[account.authId, account.id]]);
  });

  it("returns an empty map for empty input without querying", async () => {
    const query = vi.spyOn(pool, "query");

    const ids = await findAccountPublicIds(db, []);

    expect(ids.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves ids without an account out of the map", async () => {
    const known = await insertAccount();
    const missing = `${PREFIX}${randomUUID()}`;

    const ids = await findAccountPublicIds(db, [known.authId, missing]);

    expect(ids.has(missing)).toBe(false);
    expect(ids.get(known.authId)).toBe(known.id);
  });

  it("serves only the requested accounts", async () => {
    const wanted = await insertAccount();
    await insertAccount();

    const ids = await findAccountPublicIds(db, [wanted.authId]);

    expect([...ids.keys()]).toEqual([wanted.authId]);
  });

  it("runs inside a caller's transaction and sees its uncommitted rows", async () => {
    const authId = `${PREFIX}${randomUUID()}`;

    const seen = await db.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(accounts)
        .values({
          auth_id: authId,
          email: `${authId}@example.test`,
          role: "CLIENT",
        })
        .returning({ id: accounts.id });
      const ids = await findAccountPublicIds(transaction, [authId]);
      return { inserted: row!.id, found: ids.get(authId) };
    });

    expect(seen.found).toBe(seen.inserted);
  });
});
