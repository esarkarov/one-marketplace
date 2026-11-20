import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import {
  contract_milestones,
  contracts,
} from "@/modules/contracts/models/contracts.model.js";
import { conversations } from "@/modules/messaging/models/messaging.model.js";

export interface RefundCandidateFilter {
  now: Date;
  cancelledBefore: Date;
  maxAttempts: number;
  limit: number;
}

const candidateColumns = {
  id: contracts.id,
  attempts: contracts.refund_attempts,
  cancelledAt: contracts.cancelled_at,
  cancelledBy: contracts.cancelled_by,
};

const candidateWhere = (executor: DbExecutor, filter: RefundCandidateFilter) =>
  and(
    eq(contracts.status, "CANCELLED"),
    isNull(contracts.refunded_at),
    lt(contracts.refund_attempts, filter.maxAttempts),
    or(
      isNull(contracts.cancelled_at),
      lte(contracts.cancelled_at, filter.cancelledBefore),
    ),
    or(
      isNull(contracts.refund_next_attempt_at),
      lte(contracts.refund_next_attempt_at, filter.now),
    ),
    exists(
      executor
        .select({ one: sql`1` })
        .from(contract_milestones)
        .where(
          and(
            eq(contract_milestones.contract_id, contracts.id),
            eq(contract_milestones.position, 0),
            isNotNull(contract_milestones.funded_at),
            or(
              isNotNull(contract_milestones.stripe_payment_intent_id),
              isNotNull(contract_milestones.stripe_checkout_session_id),
            ),
          ),
        ),
    ),
  );

const candidateOrder = [
  sql`${contracts.refund_next_attempt_at} ASC NULLS FIRST`,
  asc(contracts.id),
];

interface ClaimedRefundRow extends Record<string, unknown> {
  id: string;
  attempts: number;
  cancelled_at: Date | string | null;
  cancelled_by: "CLIENT" | "TALENT" | null;
}

export const claimRefundCandidates = async (
  executor: DbExecutor,
  filter: RefundCandidateFilter & { leaseUntil: Date },
) => {
  const picked = executor
    .select({ id: contracts.id })
    .from(contracts)
    .where(candidateWhere(executor, filter))
    .orderBy(...candidateOrder)
    .limit(filter.limit)
    .for("update", { skipLocked: true });
  const result = await executor.execute<ClaimedRefundRow>(sql`
    WITH picked AS MATERIALIZED (${picked})
    UPDATE contracts
    SET refund_next_attempt_at = ${filter.leaseUntil.toISOString()}::timestamptz
    FROM picked
    WHERE contracts.id = picked.id
    RETURNING contracts.id AS id,
      contracts.refund_attempts AS attempts,
      contracts.cancelled_at AS cancelled_at,
      contracts.cancelled_by AS cancelled_by
  `);
  return result.rows.map((row) => ({
    id: row.id,
    attempts: row.attempts,
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at),
    cancelledBy: row.cancelled_by,
  }));
};

export const listRefundCandidates = (
  executor: DbExecutor,
  filter: RefundCandidateFilter,
) =>
  executor
    .select(candidateColumns)
    .from(contracts)
    .where(candidateWhere(executor, filter))
    .orderBy(...candidateOrder)
    .limit(filter.limit);

export const findRefundTargets = (
  executor: DbExecutor,
  contractIds: string[],
) =>
  executor
    .select({
      id: contracts.id,
      title: contracts.title,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      conversationId: conversations.id,
      checkoutSessionId: contract_milestones.stripe_checkout_session_id,
      paymentIntentId: contract_milestones.stripe_payment_intent_id,
    })
    .from(contracts)
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .innerJoin(
      contract_milestones,
      and(
        eq(contract_milestones.contract_id, contracts.id),
        eq(contract_milestones.position, 0),
        isNotNull(contract_milestones.funded_at),
      ),
    )
    .where(inArray(contracts.id, contractIds));

const unrecordedRefund = (contractId: string) =>
  and(
    eq(contracts.id, contractId),
    eq(contracts.status, "CANCELLED"),
    isNull(contracts.refunded_at),
  );

export const releaseRefundLeases = (
  executor: DbExecutor,
  contractIds: string[],
) =>
  executor
    .update(contracts)
    .set({ refund_next_attempt_at: null })
    .where(
      and(
        inArray(contracts.id, contractIds),
        eq(contracts.status, "CANCELLED"),
        isNull(contracts.refunded_at),
      ),
    )
    .returning({ id: contracts.id });

export const recordRefundFailure = (
  executor: DbExecutor,
  contractId: string,
  failure: {
    attempts: number;
    lastError: string;
    nextAttemptAt: Date | null;
  },
) =>
  executor
    .update(contracts)
    .set({
      refund_attempts: failure.attempts,
      refund_last_error: failure.lastError,
      refund_next_attempt_at: failure.nextAttemptAt,
    })
    .where(unrecordedRefund(contractId))
    .returning({ id: contracts.id });
