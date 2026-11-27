import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/database/client.js";
import { assertTestDatabase } from "@/test/setup/assert-test-database.js";
import { openLockHolder } from "@/test/support/lock-holder.js";
import {
  claimOutboxEvents,
  deletePublishedOutboxEvents,
  insertOutboxEvent,
  markOutboxEventDead,
  markOutboxEventPublished,
  readOutboxStats,
  releaseOutboxEvent,
  scheduleOutboxEventRetry,
} from "@/modules/outbox/repositories/outbox.repository.js";

const LEASE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const CLAIM_DEADLINE_MS = 3_000;

const payload = {
  recipientId: "outbox-it-recipient",
  type: "PROPOSAL_RECEIVED",
  title: "Title",
  message: "Message",
};

const insertRows = async (count: number): Promise<string[]> => {
  const eventIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const eventId = randomUUID();
    await insertOutboxEvent(db, { eventId, payload, traceparent: null });
    eventIds.push(eventId);
  }
  const result = await pool.query<{ id: string }>(
    "select id from outbox_events where event_id = any($1::uuid[]) order by id",
    [eventIds],
  );
  return result.rows.map((row) => row.id);
};

const rowById = async (id: string) =>
  (
    await pool.query<{
      status: string;
      attempts: number;
      claimed_at: Date | null;
      next_attempt_at: Date;
      last_error: string | null;
      published_at: Date | null;
      due_in_ms: number;
    }>(
      `select status, attempts, claimed_at, next_attempt_at, last_error, published_at,
        extract(epoch from next_attempt_at - now()) * 1000 as due_in_ms
       from outbox_events where id = $1`,
      [id],
    )
  ).rows[0];

const withinDeadline = <T>(work: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("claim blocked on a locked row")),
        CLAIM_DEADLINE_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

beforeAll(async () => {
  assertTestDatabase(process.env.DATABASE_URL, process.env.POSTGRES_DB);
});

beforeEach(async () => {
  await pool.query("delete from outbox_events");
});

afterAll(async () => {
  await pool.query("delete from outbox_events");
});

describe("insertOutboxEvent", () => {
  it("is idempotent on event_id", async () => {
    const eventId = randomUUID();

    expect(
      await insertOutboxEvent(db, { eventId, payload, traceparent: "tp" }),
    ).toBe(true);
    expect(
      await insertOutboxEvent(db, { eventId, payload, traceparent: null }),
    ).toBe(false);

    const result = await pool.query(
      "select status, attempts, traceparent from outbox_events where event_id = $1",
      [eventId],
    );
    expect(result.rows).toEqual([
      { status: "PENDING", attempts: 0, traceparent: "tp" },
    ]);
  });

  it("leaves no row when the surrounding transaction rolls back", async () => {
    const eventId = randomUUID();
    class Rollback extends Error {}

    await expect(
      db.transaction(async (tx) => {
        await insertOutboxEvent(tx, { eventId, payload, traceparent: null });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    const result = await pool.query(
      "select 1 from outbox_events where event_id = $1",
      [eventId],
    );
    expect(result.rowCount).toBe(0);
  });
});

describe("claimOutboxEvents", () => {
  it("skips rows another claimer holds and never blocks on them", async () => {
    const ids = await insertRows(4);
    const held = ids.slice(0, 2);
    const holder = await openLockHolder(async (client) => {
      await client.query(
        "select id from outbox_events where id = any($1::uuid[]) for update",
        [held],
      );
    });
    try {
      const claimed = await withinDeadline(
        claimOutboxEvents(db, { limit: 10, leaseMs: LEASE_MS }),
      );

      expect(claimed.map((row) => row.id).sort()).toEqual(ids.slice(2).sort());
    } finally {
      await holder.release();
    }
  });

  it("never returns the same row to two concurrent claims", async () => {
    const ids = await insertRows(6);

    const [first, second] = await Promise.all([
      claimOutboxEvents(db, { limit: 3, leaseMs: LEASE_MS }),
      claimOutboxEvents(db, { limit: 3, leaseMs: LEASE_MS }),
    ]);

    const firstIds = first.map((row) => row.id);
    const secondIds = second.map((row) => row.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect([...firstIds, ...secondIds].sort()).toEqual(ids);
  });

  it("marks claimed rows PUBLISHING and counts the attempt", async () => {
    const [id] = await insertRows(1);

    const [claimed] = await claimOutboxEvents(db, {
      limit: 10,
      leaseMs: LEASE_MS,
    });

    expect(claimed).toMatchObject({ id, attempts: 1, payload });
    const row = await rowById(id!);
    expect(row?.status).toBe("PUBLISHING");
    expect(row?.claimed_at).not.toBeNull();
  });

  it("respects the limit and leaves rows that are not due", async () => {
    const ids = await insertRows(3);
    await pool.query(
      "update outbox_events set next_attempt_at = now() + interval '1 hour' where id = $1",
      [ids[0]],
    );

    const claimed = await claimOutboxEvents(db, {
      limit: 1,
      leaseMs: LEASE_MS,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).not.toBe(ids[0]);
  });

  it("reclaims a row whose lease expired and leaves a live lease alone", async () => {
    const [expired, live] = await insertRows(2);
    await pool.query(
      `update outbox_events set status = 'PUBLISHING', attempts = 1,
        claimed_at = now() - interval '2 minutes' where id = $1`,
      [expired],
    );
    await pool.query(
      `update outbox_events set status = 'PUBLISHING', attempts = 1,
        claimed_at = now() where id = $1`,
      [live],
    );

    const claimed = await claimOutboxEvents(db, {
      limit: 10,
      leaseMs: LEASE_MS,
    });

    expect(claimed.map((row) => [row.id, row.attempts])).toEqual([
      [expired, 2],
    ]);
  });
});

describe("guarded marks", () => {
  const claimOne = async () => {
    await insertRows(1);
    const [claimed] = await claimOutboxEvents(db, {
      limit: 1,
      leaseMs: LEASE_MS,
    });
    return claimed!;
  };

  it("changes nothing when the attempts value is stale", async () => {
    const claimed = await claimOne();
    const stale = claimed.attempts - 1;

    expect(await markOutboxEventPublished(db, claimed.id, stale)).toBe(false);
    expect(
      await scheduleOutboxEventRetry(db, claimed.id, stale, 5_000, "x"),
    ).toBe(false);
    expect(await markOutboxEventDead(db, claimed.id, stale, "x")).toBe(false);
    expect(await releaseOutboxEvent(db, claimed.id, stale, 1_000)).toBe(false);
    expect(await rowById(claimed.id)).toMatchObject({
      status: "PUBLISHING",
      attempts: 1,
      last_error: null,
      published_at: null,
    });
  });

  it("marks PUBLISHED with the claimed attempts and only once", async () => {
    const claimed = await claimOne();

    expect(
      await markOutboxEventPublished(db, claimed.id, claimed.attempts),
    ).toBe(true);
    expect(
      await markOutboxEventPublished(db, claimed.id, claimed.attempts),
    ).toBe(false);
    const row = await rowById(claimed.id);
    expect(row).toMatchObject({ status: "PUBLISHED", claimed_at: null });
    expect(row?.published_at).not.toBeNull();
  });

  it("schedules a retry with the backoff delay and the error", async () => {
    const claimed = await claimOne();

    expect(
      await scheduleOutboxEventRetry(
        db,
        claimed.id,
        claimed.attempts,
        5_000,
        "publish_failed",
      ),
    ).toBe(true);
    const row = await rowById(claimed.id);
    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 1,
      claimed_at: null,
      last_error: "publish_failed",
    });
    expect(Number(row?.due_in_ms)).toBeGreaterThan(4_000);
    expect(Number(row?.due_in_ms)).toBeLessThanOrEqual(5_000);
  });

  it("marks DEAD", async () => {
    const claimed = await claimOne();

    expect(
      await markOutboxEventDead(db, claimed.id, claimed.attempts, "boom"),
    ).toBe(true);
    expect(await rowById(claimed.id)).toMatchObject({
      status: "DEAD",
      last_error: "boom",
    });
    expect(
      await claimOutboxEvents(db, { limit: 10, leaseMs: LEASE_MS }),
    ).toEqual([]);
  });

  it("releases without counting the attempt", async () => {
    const claimed = await claimOne();

    expect(await releaseOutboxEvent(db, claimed.id, claimed.attempts, 0)).toBe(
      true,
    );
    expect(await rowById(claimed.id)).toMatchObject({
      status: "PENDING",
      attempts: 0,
      claimed_at: null,
    });
  });
});

describe("retention and stats", () => {
  it("deletes only PUBLISHED rows older than the retention, in batches", async () => {
    const ids = await insertRows(6);
    const [old1, old2, old3, recent, dead, pending] = ids;
    for (const id of [old1, old2, old3]) {
      await pool.query(
        `update outbox_events set status = 'PUBLISHED',
          published_at = now() - interval '8 days' where id = $1`,
        [id],
      );
    }
    await pool.query(
      `update outbox_events set status = 'PUBLISHED',
        published_at = now() - interval '1 day' where id = $1`,
      [recent],
    );
    await pool.query(
      `update outbox_events set status = 'DEAD',
        created_at = now() - interval '30 days' where id = $1`,
      [dead],
    );

    expect(await deletePublishedOutboxEvents(db, 7 * DAY_MS, 2)).toBe(2);
    expect(await deletePublishedOutboxEvents(db, 7 * DAY_MS, 2)).toBe(1);
    expect(await deletePublishedOutboxEvents(db, 7 * DAY_MS, 2)).toBe(0);

    const left = await pool.query<{ id: string }>(
      "select id from outbox_events order by id",
    );
    expect(left.rows.map((row) => row.id)).toEqual(
      [recent, dead, pending].sort(),
    );
  });

  it("reports pending count, oldest pending age and dead count", async () => {
    expect(await readOutboxStats(db)).toEqual({
      pending: 0,
      oldestPendingAgeMs: 0,
      dead: 0,
    });

    const [oldest, publishing, dead, published] = await insertRows(4);
    await pool.query(
      "update outbox_events set created_at = now() - interval '90 seconds' where id = $1",
      [oldest],
    );
    await pool.query(
      "update outbox_events set status = 'PUBLISHING', claimed_at = now() where id = $1",
      [publishing],
    );
    await pool.query("update outbox_events set status = 'DEAD' where id = $1", [
      dead,
    ]);
    await pool.query(
      "update outbox_events set status = 'PUBLISHED', published_at = now() where id = $1",
      [published],
    );

    const stats = await readOutboxStats(db);
    expect(stats.pending).toBe(2);
    expect(stats.dead).toBe(1);
    expect(stats.oldestPendingAgeMs).toBeGreaterThanOrEqual(90_000);
    expect(stats.oldestPendingAgeMs).toBeLessThan(100_000);
  });
});
