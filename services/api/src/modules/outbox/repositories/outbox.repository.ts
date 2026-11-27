import { and, asc, eq, lt, lte, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { outbox_events } from "@/modules/outbox/models/outbox.model.js";
import type {
  ClaimedOutboxEvent,
  OutboxClaimOptions,
  OutboxEventInsert,
  OutboxStats,
} from "@/modules/outbox/types/outbox.types.js";

export const insertOutboxEvent = async (
  executor: DbExecutor,
  input: OutboxEventInsert,
): Promise<boolean> => {
  const inserted = await executor
    .insert(outbox_events)
    .values({
      event_id: input.eventId,
      payload: input.payload,
      traceparent: input.traceparent,
    })
    .onConflictDoNothing({ target: outbox_events.event_id })
    .returning({ id: outbox_events.id });
  return inserted.length > 0;
};

interface ClaimedOutboxRow extends Record<string, unknown> {
  id: string;
  event_id: string;
  payload: unknown;
  traceparent: string | null;
  attempts: number;
}

export const claimOutboxEvents = async (
  executor: DbExecutor,
  options: OutboxClaimOptions,
): Promise<ClaimedOutboxEvent[]> => {
  const leaseExpiredBefore = sql`now() - (${options.leaseMs} * interval '1 millisecond')`;
  const picked = executor
    .select({ id: outbox_events.id })
    .from(outbox_events)
    .where(
      or(
        and(
          eq(outbox_events.status, "PENDING"),
          lte(outbox_events.next_attempt_at, sql`now()`),
        ),
        and(
          eq(outbox_events.status, "PUBLISHING"),
          lt(outbox_events.claimed_at, leaseExpiredBefore),
        ),
      ),
    )
    .orderBy(asc(outbox_events.next_attempt_at), asc(outbox_events.id))
    .limit(options.limit)
    .for("update", { skipLocked: true });
  const result = await executor.execute<ClaimedOutboxRow>(sql`
    WITH picked AS MATERIALIZED (${picked})
    UPDATE outbox_events
    SET status = 'PUBLISHING',
      claimed_at = now(),
      attempts = outbox_events.attempts + 1
    FROM picked
    WHERE outbox_events.id = picked.id
    RETURNING outbox_events.id AS id,
      outbox_events.event_id AS event_id,
      outbox_events.payload AS payload,
      outbox_events.traceparent AS traceparent,
      outbox_events.attempts AS attempts
  `);
  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    payload: row.payload,
    traceparent: row.traceparent,
    attempts: Number(row.attempts),
  }));
};

const claimedBy = (id: string, claimedAttempts: number) =>
  and(
    eq(outbox_events.id, id),
    eq(outbox_events.status, "PUBLISHING"),
    eq(outbox_events.attempts, claimedAttempts),
  );

export const markOutboxEventPublished = async (
  executor: DbExecutor,
  id: string,
  claimedAttempts: number,
): Promise<boolean> => {
  const updated = await executor
    .update(outbox_events)
    .set({
      status: "PUBLISHED",
      published_at: sql`now()`,
      claimed_at: null,
      last_error: null,
    })
    .where(claimedBy(id, claimedAttempts))
    .returning({ id: outbox_events.id });
  return updated.length > 0;
};

export const scheduleOutboxEventRetry = async (
  executor: DbExecutor,
  id: string,
  claimedAttempts: number,
  delayMs: number,
  lastError: string,
): Promise<boolean> => {
  const updated = await executor
    .update(outbox_events)
    .set({
      status: "PENDING",
      next_attempt_at: sql`now() + (${delayMs} * interval '1 millisecond')`,
      claimed_at: null,
      last_error: lastError,
    })
    .where(claimedBy(id, claimedAttempts))
    .returning({ id: outbox_events.id });
  return updated.length > 0;
};

export const markOutboxEventDead = async (
  executor: DbExecutor,
  id: string,
  claimedAttempts: number,
  lastError: string,
): Promise<boolean> => {
  const updated = await executor
    .update(outbox_events)
    .set({ status: "DEAD", claimed_at: null, last_error: lastError })
    .where(claimedBy(id, claimedAttempts))
    .returning({ id: outbox_events.id });
  return updated.length > 0;
};

export const releaseOutboxEvent = async (
  executor: DbExecutor,
  id: string,
  claimedAttempts: number,
  delayMs: number,
): Promise<boolean> => {
  const updated = await executor
    .update(outbox_events)
    .set({
      status: "PENDING",
      attempts: sql`${outbox_events.attempts} - 1`,
      next_attempt_at: sql`now() + (${delayMs} * interval '1 millisecond')`,
      claimed_at: null,
    })
    .where(claimedBy(id, claimedAttempts))
    .returning({ id: outbox_events.id });
  return updated.length > 0;
};

export const deletePublishedOutboxEvents = async (
  executor: DbExecutor,
  olderThanMs: number,
  limit: number,
): Promise<number> => {
  const doomed = executor
    .select({ id: outbox_events.id })
    .from(outbox_events)
    .where(
      and(
        eq(outbox_events.status, "PUBLISHED"),
        lt(
          outbox_events.published_at,
          sql`now() - (${olderThanMs} * interval '1 millisecond')`,
        ),
      ),
    )
    .orderBy(asc(outbox_events.published_at), asc(outbox_events.id))
    .limit(limit);
  const result = await executor.execute(sql`
    WITH doomed AS MATERIALIZED (${doomed})
    DELETE FROM outbox_events
    USING doomed
    WHERE outbox_events.id = doomed.id
  `);
  return result.rowCount ?? 0;
};

interface OutboxStatsRow extends Record<string, unknown> {
  pending: number | string;
  oldest_pending_age_ms: number | string | null;
  dead: number | string;
}

export const readOutboxStats = async (
  executor: DbExecutor,
): Promise<OutboxStats> => {
  const result = await executor.execute<OutboxStatsRow>(sql`
    SELECT
      count(*) FILTER (WHERE status IN ('PENDING', 'PUBLISHING')) AS pending,
      floor(extract(epoch FROM now() - min(created_at)
        FILTER (WHERE status IN ('PENDING', 'PUBLISHING'))) * 1000)
        AS oldest_pending_age_ms,
      count(*) FILTER (WHERE status = 'DEAD') AS dead
    FROM outbox_events
    WHERE status IN ('PENDING', 'PUBLISHING', 'DEAD')
  `);
  const row = result.rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    oldestPendingAgeMs: Math.max(0, Number(row?.oldest_pending_age_ms ?? 0)),
    dead: Number(row?.dead ?? 0),
  };
};
