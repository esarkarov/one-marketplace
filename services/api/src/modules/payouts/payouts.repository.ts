import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { payout_history } from "./payouts.schema.js";
import {
  allowedFrom,
  assertTransition,
  requireAllowedFrom,
  STUCK_CLAIM_MINUTES,
  type PayoutStatus,
} from "./payouts.state.js";

const NOTIFICATION_SWEEP_LIMIT = 300;

export type PayoutRecord = typeof payout_history.$inferSelect;

const fromCondition = (from: PayoutStatus, to: PayoutStatus): SQL => {
  const isStatus = eq(payout_history.status, from);
  if (to !== "PROCESSING") return isStatus;
  if (from === "FAILED") {
    return sql`(${isStatus} AND ${payout_history.next_retry_at} IS NOT NULL AND ${payout_history.next_retry_at} <= now())`;
  }
  if (from === "PROCESSING") {
    return sql`(${isStatus} AND ${payout_history.claimed_at} < now() - ${sql.raw(`interval '${STUCK_CLAIM_MINUTES} minutes'`)})`;
  }
  return isStatus;
};

export const claimableCondition = (): SQL =>
  or(
    ...allowedFrom("PROCESSING").map((from) =>
      fromCondition(from, "PROCESSING"),
    ),
  ) as SQL;

export const buildTransitionGuard = (
  id: string,
  to: PayoutStatus,
  options: { from?: PayoutStatus; expectedAttempts?: number } = {},
): SQL => {
  const froms = options.from ? [options.from] : requireAllowedFrom(to);
  for (const from of froms) assertTransition(from, to);

  const statusList = sql.join(
    froms.map((from) => sql`${from}`),
    sql`, `,
  );
  const conditions: (SQL | undefined)[] = [
    eq(payout_history.id, id),
    sql`${payout_history.status} = ANY(ARRAY[${statusList}]::text[])`,
    or(...froms.map((from) => fromCondition(from, to))),
  ];
  if (options.expectedAttempts !== undefined) {
    conditions.push(eq(payout_history.attempts, options.expectedAttempts));
  }
  if (to === "PROCESSING") {
    conditions.push(
      sql`${payout_history.id} IN (SELECT p.id FROM payout_history p WHERE p.id = ${id} FOR UPDATE SKIP LOCKED)`,
    );
  }
  return and(...conditions) as SQL;
};

export type PayoutPatch = Omit<
  PgUpdateSetSource<typeof payout_history>,
  "status"
>;

export type ClaimedPayout = PayoutRecord & {
  prev_claimed_at: unknown;
  prev_idempotency_key: string | null;
};

export const claimPayoutIfClaimableSkipLocked = async (
  executor: DbExecutor,
  input: {
    id: string;
    destination: string;
  },
): Promise<ClaimedPayout | undefined> => {
  const guard = buildTransitionGuard(input.id, "PROCESSING");
  const result = await executor.execute<ClaimedPayout>(sql`
    UPDATE payout_history
    SET status = 'PROCESSING',
      attempts = ${payout_history.attempts} + 1,
      claimed_at = now(),
      next_retry_at = NULL,
      destination_account_id = COALESCE(${payout_history.destination_account_id}, ${input.destination}),
      idempotency_key = COALESCE(${payout_history.idempotency_key}, 'payout:' || ${payout_history.id}::text || ':1')
    FROM (
      SELECT o.id, o.claimed_at, o.idempotency_key
      FROM payout_history o
      WHERE o.id = ${input.id}
      FOR UPDATE OF o SKIP LOCKED
    ) AS old
    WHERE ${payout_history.id} = old.id AND ${guard}
    RETURNING payout_history.*,
      old.claimed_at AS prev_claimed_at,
      old.idempotency_key AS prev_idempotency_key
  `);
  const row = result.rows[0];
  return row && { ...row, amount_cents: Number(row.amount_cents) };
};

export const transitionPayoutIfAllowed = async (
  executor: DbExecutor,
  input: {
    id: string;
    to: PayoutStatus;
    from?: PayoutStatus;
    expectedAttempts?: number;
    set?: PayoutPatch;
  },
): Promise<PayoutRecord | undefined> => {
  const guard = buildTransitionGuard(input.id, input.to, {
    from: input.from,
    expectedAttempts: input.expectedAttempts,
  });
  const [row] = await executor
    .update(payout_history)
    .set({ ...input.set, status: input.to })
    .where(guard)
    .returning();
  return row;
};

export const markPayoutNotifiedIfUnnotified = async (
  executor: DbExecutor,
  id: string,
) => {
  await executor
    .update(payout_history)
    .set({ notified_at: sql`now()` })
    .where(and(eq(payout_history.id, id), isNull(payout_history.notified_at)));
};

export const findUnnotifiedPaidPayouts = (executor: DbExecutor) =>
  executor
    .select()
    .from(payout_history)
    .where(
      and(
        eq(payout_history.status, "PAID"),
        isNull(payout_history.notified_at),
      ),
    )
    .orderBy(asc(payout_history.paid_at))
    .limit(NOTIFICATION_SWEEP_LIMIT);

export const insertPendingPayoutsForDueEarnings = async (
  executor: DbExecutor,
  cutoff: Date,
) => {
  await executor.execute(sql`
    INSERT INTO payout_history
      (freelancer_id, agency_id, earning_history_id, amount_cents, status)
    SELECT e.freelancer_id, e.agency_id, e.id,
      (e.amount_cents - e.platform_fee_cents), 'PENDING'
    FROM earning_history e
    WHERE e.created_at <= ${cutoff.toISOString()}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM payout_history p WHERE p.earning_history_id = e.id
      )
    ON CONFLICT (earning_history_id) DO NOTHING
  `);
};

export const findClaimableCandidates = (executor: DbExecutor) =>
  executor
    .select({
      id: payout_history.id,
      earningHistoryId: payout_history.earning_history_id,
      amountCents: payout_history.amount_cents,
      status: payout_history.status,
      freelancerId: payout_history.freelancer_id,
      agencyId: payout_history.agency_id,
      freelancerAccountId: accounts.stripe_connect_account_id,
      agencyAccountId: agency_metadata.stripe_connect_account_id,
    })
    .from(payout_history)
    .leftJoin(accounts, eq(accounts.auth_id, payout_history.freelancer_id))
    .leftJoin(agency_metadata, eq(agency_metadata.id, payout_history.agency_id))
    .where(claimableCondition())
    .orderBy(asc(payout_history.created_at));

export const failProcessingPayoutIfAttemptsMatch = (
  executor: DbExecutor,
  input: {
    id: string;
    attempts: number;
    lastError: string;
    retryDelaySeconds: number | null;
    idempotencyKey?: string;
  },
) =>
  transitionPayoutIfAllowed(executor, {
    id: input.id,
    from: "PROCESSING",
    to: "FAILED",
    expectedAttempts: input.attempts,
    set: {
      last_error: input.lastError,
      next_retry_at:
        input.retryDelaySeconds === null
          ? null
          : sql`now() + (${input.retryDelaySeconds}::int * interval '1 second')`,
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotency_key: input.idempotencyKey }),
    },
  });

export const parkProcessingPayoutIfAttemptsMatch = (
  executor: DbExecutor,
  input: { id: string; attempts: number; lastError: string },
) =>
  transitionPayoutIfAllowed(executor, {
    id: input.id,
    from: "PROCESSING",
    to: "FAILED",
    expectedAttempts: input.attempts,
    set: { last_error: input.lastError, next_retry_at: null },
  });

export const markProcessingPayoutPaidIfAttemptsMatch = (
  executor: DbExecutor,
  input: { id: string; attempts: number; transferId: string },
) =>
  transitionPayoutIfAllowed(executor, {
    id: input.id,
    from: "PROCESSING",
    to: "PAID",
    expectedAttempts: input.attempts,
    set: {
      stripe_transfer_id: input.transferId,
      paid_at: sql`now()`,
      last_error: null,
      next_retry_at: null,
    },
  });
