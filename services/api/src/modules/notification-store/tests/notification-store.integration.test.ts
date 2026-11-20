import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { accounts, agency_metadata } from "@/test/support/tables.js";
import {
  insertNotification,
  markAllNotificationsRead,
  markNotificationReadForRecipient,
} from "@/modules/notification-store/repositories/notification-store.repository.js";
import type { NotificationInsertInput } from "@/modules/notification-store/types/notification-store.types.js";

const PREFIX = "notification-store-it-";

class Rollback extends Error {}

const purge = async () => {
  await pool.query("delete from notifications where event_id like $1", [
    `${PREFIX}%`,
  ]);
  await pool.query("delete from accounts where auth_id like $1", [
    `${PREFIX}%`,
  ]);
};

const countRows = async (eventId: string) =>
  Number(
    (
      await pool.query(
        "select count(*)::int as n from notifications where event_id = $1",
        [eventId],
      )
    ).rows[0].n,
  );

const accountInput = (
  overrides: Partial<NotificationInsertInput> = {},
): NotificationInsertInput => ({
  eventId: `${PREFIX}${randomUUID()}`,
  recipientId: `${PREFIX}recipient`,
  agencyId: null,
  type: "TEST_NOTICE",
  title: "Title",
  message: "Message",
  link: "/somewhere",
  metadata: { contractId: "c1" },
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  ...overrides,
});

const insertAgency = async () => {
  const ownerId = `${PREFIX}${randomUUID()}`;
  await db.insert(accounts).values({
    auth_id: ownerId,
    email: `${ownerId}@example.test`,
    role: "FREELANCER",
  });
  const [agency] = await db
    .insert(agency_metadata)
    .values({
      owner_id: ownerId,
      name: "Store agency",
      size: "1-10",
      specialty: "Testing",
      overview: "Overview",
    })
    .returning({ id: agency_metadata.id });
  return agency!.id;
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
  await purge();
});

afterEach(purge);

afterAll(async () => {
  await purge();
  await pool.end();
});

describe("insertNotification", () => {
  it("inserts an account-target row and returns it", async () => {
    const input = accountInput();

    const row = await insertNotification(db, input);

    expect(row).toMatchObject({
      event_id: input.eventId,
      recipient_id: input.recipientId,
      agency_id: null,
      type: "TEST_NOTICE",
      title: "Title",
      message: "Message",
      link: "/somewhere",
      metadata: { contractId: "c1" },
      is_read: false,
      read_at: null,
    });
    expect(row!.created_at).toEqual(input.createdAt);
    expect(await countRows(input.eventId)).toBe(1);
  });

  it("inserts an agency-target row", async () => {
    const agencyId = await insertAgency();
    const input = accountInput({ recipientId: null, agencyId });

    const row = await insertNotification(db, input);

    expect(row).toMatchObject({ agency_id: agencyId, recipient_id: null });
    expect(await countRows(input.eventId)).toBe(1);
  });

  it("returns null and keeps one row when the event id already exists", async () => {
    const input = accountInput();

    const first = await insertNotification(db, input);
    const second = await insertNotification(db, {
      ...input,
      title: "Changed",
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await countRows(input.eventId)).toBe(1);
    const stored = await pool.query(
      "select title from notifications where event_id = $1",
      [input.eventId],
    );
    expect(stored.rows[0].title).toBe("Title");
  });

  it("leaves no row when the surrounding transaction rolls back", async () => {
    const input = accountInput();

    await expect(
      db.transaction(async (transaction) => {
        const row = await insertNotification(transaction, input);
        expect(row).not.toBeNull();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(await countRows(input.eventId)).toBe(0);
  });

  it("leaves one row when the surrounding transaction commits", async () => {
    const input = accountInput();

    await db.transaction(async (transaction) => {
      await insertNotification(transaction, input);
    });

    expect(await countRows(input.eventId)).toBe(1);
  });

  it("is not visible outside an open transaction until it commits", async () => {
    const input = accountInput();

    await db.transaction(async (transaction) => {
      await insertNotification(transaction, input);
      expect(await countRows(input.eventId)).toBe(0);
    });

    expect(await countRows(input.eventId)).toBe(1);
  });
});

describe("read updates", () => {
  it("marks every notification of a recipient read", async () => {
    const mine = accountInput();
    const other = accountInput({ recipientId: `${PREFIX}other` });
    await insertNotification(db, mine);
    await insertNotification(db, other);

    await markAllNotificationsRead(db, mine.recipientId!, null);

    const rows = await pool.query(
      "select event_id, is_read from notifications where event_id = any($1)",
      [[mine.eventId, other.eventId]],
    );
    const byEvent = new Map(rows.rows.map((r) => [r.event_id, r.is_read]));
    expect(byEvent.get(mine.eventId)).toBe(true);
    expect(byEvent.get(other.eventId)).toBe(false);
  });

  it("marks one notification read only for its recipient", async () => {
    const input = accountInput();
    const row = (await insertNotification(db, input))!;

    expect(
      await markNotificationReadForRecipient(
        db,
        `${PREFIX}stranger`,
        row.id,
        null,
      ),
    ).toEqual([]);
    expect(
      await markNotificationReadForRecipient(
        db,
        input.recipientId!,
        row.id,
        null,
      ),
    ).toEqual([{ id: row.id }]);
  });
});
