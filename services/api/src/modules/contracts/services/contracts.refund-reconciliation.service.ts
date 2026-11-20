import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import { stripe } from "@/infrastructure/payments/stripe.client.js";
import { REFUND_RECONCILIATION } from "@/modules/contracts/constants/contracts.constants.js";
import {
  claimRefundCandidates,
  findRefundTargets,
  listRefundCandidates,
  recordRefundFailure,
  releaseRefundLeases,
} from "@/modules/contracts/repositories/contracts.refund-reconciliation.repository.js";
import {
  isPermanentRefundCode,
  isStripeUnavailable,
  stripeErrorFields,
} from "@/modules/contracts/utils/contracts.stripe-errors.js";
import {
  refundContractFirstPayment,
  resolveContractPaymentIntentId,
} from "./contracts.checkout.service.js";
import {
  notifyCancellation,
  recordRefundWithNotice,
} from "./contracts.lifecycle.service.js";

export type RefundReconciliationMode = "detect" | "on";

export interface RefundReconciliationSummary {
  scanned: number;
  markedDone: number;
  refunded: number;
  retriedLater: number;
  parked: number;
  skippedStripeUnavailable: number;
  detected: number;
  aborted: boolean;
  skipped: "no-stripe-key" | null;
}

type Outcome =
  | "markedDone"
  | "refunded"
  | "detected"
  | "retriedLater"
  | "parked"
  | "unavailable"
  | "failedInDetect";

interface Candidate {
  id: string;
  attempts: number;
  cancelledAt: Date | null;
}

type Target = Awaited<ReturnType<typeof findRefundTargets>>[number];

class PaymentIntentMissingError extends Error {
  override name = "PaymentIntentMissingError";
}

class ContractDetailsMissingError extends Error {
  override name = "ContractDetailsMissingError";
}

const errorTag = (error: unknown) => {
  const { code, type, name } = stripeErrorFields(error);
  const raw = code ?? type ?? name ?? "UnknownError";
  return raw
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, REFUND_RECONCILIATION.lastErrorMaxLength);
};

const backoffMs = (attemptsBefore: number) =>
  Math.min(
    REFUND_RECONCILIATION.baseBackoffMs * 2 ** attemptsBefore,
    REFUND_RECONCILIATION.maxBackoffMs,
  );

const keySuffixFor = (candidate: Candidate, now: Date) => {
  const originalKeyUsable =
    candidate.cancelledAt !== null &&
    now.getTime() - candidate.cancelledAt.getTime() <
      REFUND_RECONCILIATION.originalKeyWindowMs;
  return originalKeyUsable ? undefined : `:recon:${candidate.attempts}`;
};

const ageSeconds = (candidate: Candidate, now: Date) =>
  candidate.cancelledAt
    ? Math.floor((now.getTime() - candidate.cancelledAt.getTime()) / 1000)
    : null;

const isPaymentIntentRefunded = async (paymentIntentId: string) => {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const charge =
    typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  return (
    charge !== null &&
    intent.amount_received > 0 &&
    charge.amount_refunded >= intent.amount_received
  );
};

const settleRefund = async (
  candidate: Candidate,
  target: Target,
  refundId: string | null,
  now: Date,
) => {
  const { notifyFor, notice } = await recordRefundWithNotice(
    {
      id: target.id,
      title: target.title,
      conversationId: target.conversationId,
      clientId: target.clientId,
      freelancerId: target.freelancerId,
      agencyId: target.agencyId,
    },
    refundId,
    now,
  );
  if (!notifyFor) return;
  try {
    await notifyCancellation(
      {
        id: target.id,
        title: target.title,
        conversationId: target.conversationId,
        clientId: target.clientId,
        freelancerId: target.freelancerId,
        agencyId: target.agencyId,
        notifyFor,
        notice,
      },
      notifyFor === "CLIENT"
        ? target.clientId
        : (target.freelancerId ?? undefined),
    );
  } catch (error) {
    await logger.error({
      message: "Cancellation notice failed after the refund was recorded.",
      eventName: "refund.reconcile.notify_failed",
      attributes: {
        "contract.id": candidate.id,
        "error.name": error instanceof Error ? error.name : "UnknownError",
      },
    });
  }
};

const recordFailure = async (
  candidate: Candidate,
  tag: string,
  now: Date,
  permanent: boolean,
): Promise<"retriedLater" | "parked"> => {
  const attempts = permanent
    ? REFUND_RECONCILIATION.maxAttempts
    : candidate.attempts + 1;
  const parked = attempts >= REFUND_RECONCILIATION.maxAttempts;
  await recordRefundFailure(db, candidate.id, {
    attempts,
    lastError: tag,
    nextAttemptAt: parked
      ? null
      : new Date(now.getTime() + backoffMs(candidate.attempts)),
  });
  if (parked) {
    await logger.error({
      message: "Refund reconciliation gave up on a cancelled contract.",
      eventName: "refund.reconcile.parked",
      attributes: { "contract.id": candidate.id, "error.code": tag },
    });
    return "parked";
  }
  await logger.warn({
    message: "Refund reconciliation attempt failed.",
    eventName: "refund.reconcile.failed",
    attributes: {
      "contract.id": candidate.id,
      "refund.attempts": attempts,
      "error.code": tag,
    },
  });
  return "retriedLater";
};

const processCandidate = async (
  mode: RefundReconciliationMode,
  candidate: Candidate,
  target: Target | undefined,
  now: Date,
): Promise<Outcome> => {
  let refundId: string | null = null;
  let outcome: "markedDone" | "refunded";
  try {
    if (!target) throw new ContractDetailsMissingError();
    const paymentIntentId = await resolveContractPaymentIntentId(
      target.checkoutSessionId,
      target.paymentIntentId,
    );
    if (!paymentIntentId) throw new PaymentIntentMissingError();

    const alreadyRefunded = await isPaymentIntentRefunded(paymentIntentId);
    if (mode === "detect") {
      await logger.warn({
        message: "Cancelled contract has no recorded refund.",
        eventName: "refund.reconcile.detected",
        attributes: {
          "contract.id": candidate.id,
          "contract.age_seconds": ageSeconds(candidate, now),
        },
      });
      return "detected";
    }
    if (alreadyRefunded) {
      outcome = "markedDone";
    } else {
      const refund = await refundContractFirstPayment(
        target.checkoutSessionId,
        paymentIntentId,
        "refund_reconciliation",
        { keySuffix: keySuffixFor(candidate, now) },
      );
      refundId = refund.refundId;
      outcome = "refunded";
    }
  } catch (error) {
    if (isStripeUnavailable(error)) {
      if (mode === "on") await releaseRefundLeases(db, [candidate.id]);
      return "unavailable";
    }
    if (mode === "detect") {
      await logger.warn({
        message: "Refund detection could not read the payment.",
        eventName: "refund.reconcile.detect_failed",
        attributes: {
          "contract.id": candidate.id,
          "error.code": errorTag(error),
        },
      });
      return "failedInDetect";
    }
    const tag = errorTag(error);
    return recordFailure(candidate, tag, now, isPermanentRefundCode(tag));
  }

  await settleRefund(candidate, target, refundId, now);
  return outcome;
};

export const reconcileCancelledContractRefunds = async (input: {
  mode: RefundReconciliationMode;
  now?: Date;
  limit?: number;
}): Promise<RefundReconciliationSummary> => {
  const { mode } = input;
  const now = input.now ?? new Date();
  const summary: RefundReconciliationSummary = {
    scanned: 0,
    markedDone: 0,
    refunded: 0,
    retriedLater: 0,
    parked: 0,
    skippedStripeUnavailable: 0,
    detected: 0,
    aborted: false,
    skipped: null,
  };

  if (!env.stripeSecretKey) {
    await logger.info({
      message: "Refund reconciliation skipped: Stripe is not configured.",
      eventName: "refund.reconcile.skipped",
      attributes: { "refund.reconcile_mode": mode },
    });
    return { ...summary, skipped: "no-stripe-key" };
  }

  const filter = {
    now,
    cancelledBefore: new Date(
      now.getTime() - REFUND_RECONCILIATION.minCancelledAgeMs,
    ),
    maxAttempts: REFUND_RECONCILIATION.maxAttempts,
    limit: Math.max(
      0,
      Math.floor(input.limit ?? REFUND_RECONCILIATION.defaultLimit),
    ),
  };
  const candidates: Candidate[] =
    mode === "on"
      ? await claimRefundCandidates(db, {
          ...filter,
          leaseUntil: new Date(now.getTime() + REFUND_RECONCILIATION.leaseMs),
        })
      : await listRefundCandidates(db, filter);
  summary.scanned = candidates.length;

  if (candidates.length) {
    const targets = new Map(
      (
        await findRefundTargets(
          db,
          candidates.map((candidate) => candidate.id),
        )
      ).map((target) => [target.id, target]),
    );

    let consecutiveUnavailable = 0;
    for (const [index, candidate] of candidates.entries()) {
      const outcome = await processCandidate(
        mode,
        candidate,
        targets.get(candidate.id),
        now,
      );
      if (outcome === "unavailable") {
        summary.skippedStripeUnavailable += 1;
        consecutiveUnavailable += 1;
        if (
          consecutiveUnavailable >=
          REFUND_RECONCILIATION.maxConsecutiveUnavailable
        ) {
          const remaining = candidates.slice(index + 1);
          if (mode === "on" && remaining.length) {
            await releaseRefundLeases(
              db,
              remaining.map((item) => item.id),
            );
          }
          summary.aborted = true;
          break;
        }
        continue;
      }
      consecutiveUnavailable = 0;
      if (outcome !== "failedInDetect") summary[outcome] += 1;
    }
  }

  if (summary.scanned > 0 || summary.aborted) {
    await logger.info({
      message: "Refund reconciliation run finished.",
      eventName: "refund.reconcile.run",
      attributes: {
        "refund.reconcile_mode": mode,
        "refund.scanned": summary.scanned,
        "refund.marked_done": summary.markedDone,
        "refund.refunded": summary.refunded,
        "refund.retried_later": summary.retriedLater,
        "refund.parked": summary.parked,
        "refund.skipped_stripe_unavailable": summary.skippedStripeUnavailable,
        "refund.detected": summary.detected,
        "refund.aborted": summary.aborted,
      },
    });
  }
  return summary;
};
