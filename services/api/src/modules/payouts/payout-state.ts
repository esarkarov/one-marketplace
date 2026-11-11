import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../../database/client.js";
import { payout_history } from "../../database/schema.js";

export const PAYOUT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export type PayoutRecord = typeof payout_history.$inferSelect;

export const STUCK_CLAIM_MINUTES = 15;

export const ALLOWED_TRANSITIONS: Readonly<
  Record<PayoutStatus, readonly PayoutStatus[]>
> = {
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["PROCESSING", "PAID", "FAILED"],
  FAILED: ["PROCESSING"],
  PAID: [],
};

export class PayoutTransitionError extends Error {
  readonly from: PayoutStatus;
  readonly to: PayoutStatus;

  constructor(from: PayoutStatus, to: PayoutStatus) {
    super(`Payout transition ${from} -> ${to} is not allowed`);
    this.name = "PayoutTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const isTransitionAllowed = (
  from: PayoutStatus,
  to: PayoutStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

export const assertTransition = (
  from: PayoutStatus,
  to: PayoutStatus,
): void => {
  if (!isTransitionAllowed(from, to)) {
    throw new PayoutTransitionError(from, to);
  }
};

export const allowedFrom = (to: PayoutStatus): PayoutStatus[] =>
  PAYOUT_STATUSES.filter((from) => isTransitionAllowed(from, to));

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
  const froms = options.from ? [options.from] : allowedFrom(to);
  if (froms.length === 0) {
    throw new Error(`No payout transition leads to ${to}`);
  }
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

export const claimPayout = async (input: {
  id: string;
  destination: string;
}): Promise<ClaimedPayout | undefined> => {
  const guard = buildTransitionGuard(input.id, "PROCESSING");
  const result = await db.execute<ClaimedPayout>(sql`
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

export const transitionPayout = async (input: {
  id: string;
  to: PayoutStatus;
  from?: PayoutStatus;
  expectedAttempts?: number;
  set?: PayoutPatch;
}): Promise<PayoutRecord | undefined> => {
  const guard = buildTransitionGuard(input.id, input.to, {
    from: input.from,
    expectedAttempts: input.expectedAttempts,
  });
  const [row] = await db
    .update(payout_history)
    .set({ ...input.set, status: input.to })
    .where(guard)
    .returning();
  return row;
};
