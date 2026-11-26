import {
  EARNINGS_HOLD_PERIOD_MS,
  PAYOUT_BATCH_SIZE,
  PAYOUT_MAX_PER_TICK,
  PAYOUT_TICK_BUDGET_MS,
} from "@/modules/payouts/constants/payouts.constants.js";
import { stripe } from "@/infrastructure/payments/stripe.client.js";
import { db } from "@/database/client.js";
import {
  insertNotification,
  pushStoredNotification,
  type NotificationRow,
} from "@/modules/notification-store/index.js";
import { logger } from "@/config/logger.js";
import { formatUsd } from "@/shared/money/money.js";
import { uuidV5 } from "@/shared/ids/uuid-v5.js";
import {
  bumpIdempotencyKey,
  classifyPayoutFailure,
  initialIdempotencyKey,
  PAYOUT_MAX_ATTEMPTS,
  retryDelaySeconds,
  type PayoutFailure,
} from "@/modules/payouts/utils/payouts.failure.js";
import {
  claimPayoutIfClaimableSkipLocked,
  failProcessingPayoutIfAttemptsMatch,
  findClaimableCandidates,
  findUnnotifiedPaidPayouts,
  insertPendingPayoutsForDueEarnings,
  markPayoutNotifiedIfUnnotified,
  markProcessingPayoutPaidIfAttemptsMatch,
  parkProcessingPayoutIfAttemptsMatch,
  type CandidateCursor,
  type PayoutRecord,
} from "@/modules/payouts/repositories/payouts.repository.js";

const TRANSFER_LIST_LIMIT = 10;

type StoppedEarly = "budget" | "cap" | null;

interface PayoutRunSummary {
  checked: number;
  paid: number;
  skipped: number;
  failed: number;
  stoppedEarly: StoppedEarly;
}

type Outcome = "paid" | "skipped" | "failed";

interface Candidate {
  id: string;
  createdAt: string;
  earningHistoryId: string;
  amountCents: number;
  status: string;
  freelancerId: string | null;
  agencyId: string | null;
  stripeConnectAccountId: string | null;
}

const payoutAttributes = (row: {
  id: string;
  earning_history_id: string;
  freelancer_id: string | null;
  agency_id: string | null;
}) => ({
  "payout.id": row.id,
  "earning.id": row.earning_history_id,
  ...(row.freelancer_id
    ? { "user.id": row.freelancer_id }
    : { "team.id": row.agency_id }),
});

const errorIdentity = (error: unknown) => {
  const source =
    typeof error === "object" && error !== null
      ? (error as { type?: unknown; code?: unknown; name?: unknown })
      : {};
  const name = [source.type, source.name].find(
    (value): value is string => typeof value === "string",
  );
  return {
    "error.type": name ?? "UnknownError",
    ...(typeof source.code === "string" ? { "error.code": source.code } : {}),
  };
};

const payoutNoticeInput = (row: PayoutRecord) => {
  const base = {
    type: "PAYOUT_COMPLETED",
    title: "Payment sent",
    message: `The payment of ${formatUsd(row.amount_cents)} is ready for withdrawal now.`,
    metadata: {
      earningHistoryId: row.earning_history_id,
      amountCents: row.amount_cents,
      stripeTransferId: row.stripe_transfer_id,
    },
    eventId: uuidV5(row.id),
    createdAt: new Date(),
  };
  return row.freelancer_id
    ? {
        ...base,
        recipientId: row.freelancer_id,
        agencyId: null,
        link: "/settings?section=earnings",
      }
    : {
        ...base,
        recipientId: null,
        agencyId: row.agency_id!,
        link: "/finances?section=withdrawals",
      };
};

const pushPayoutNotice = async (
  row: PayoutRecord,
  notice: NotificationRow | null,
): Promise<void> => {
  if (!notice) return;
  try {
    await pushStoredNotification(notice);
  } catch (error) {
    await logger.warn({
      message: "Payout notification push failed",
      eventName: "payment.payout.notification_failed",
      attributes: { ...payoutAttributes(row), ...errorIdentity(error) },
    });
  }
};

const sweepUnnotified = async (): Promise<void> => {
  const rows = await findUnnotifiedPaidPayouts(db);

  for (const row of rows) {
    try {
      const notice = await db.transaction(async (transaction) => {
        const inserted = await insertNotification(
          transaction,
          payoutNoticeInput(row),
        );
        await markPayoutNotifiedIfUnnotified(transaction, row.id);
        return inserted;
      });
      await pushPayoutNotice(row, notice);
    } catch (error) {
      await logger.error({
        message: "Payout notification failed",
        eventName: "payment.payout.notification_failed",
        attributes: { ...payoutAttributes(row), ...errorIdentity(error) },
      });
    }
  }
};

const createDueRows = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - EARNINGS_HOLD_PERIOD_MS);

  await insertPendingPayoutsForDueEarnings(db, cutoff);
};

const selectCandidates = async (
  after: CandidateCursor | undefined,
): Promise<Candidate[]> =>
  (await findClaimableCandidates(db, { limit: PAYOUT_BATCH_SIZE, after })).map(
    (row) => ({
      id: row.id,
      createdAt: row.createdAt,
      earningHistoryId: row.earningHistoryId,
      amountCents: row.amountCents,
      status: row.status,
      freelancerId: row.freelancerId,
      agencyId: row.agencyId,
      stripeConnectAccountId: row.freelancerId
        ? row.freelancerAccountId
        : row.agencyAccountId,
    }),
  );

const isTransfersActive = async (
  candidate: Candidate,
  accountId: string,
): Promise<boolean> => {
  try {
    const destinationAccount = await stripe.v2.core.accounts.retrieve(
      accountId,
      { include: ["configuration.recipient"] },
    );
    return (
      destinationAccount.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers?.status === "active"
    );
  } catch (error) {
    await logger.error({
      message: "Could not check destination account status",
      eventName: "payment.payout.account_check_failed",
      attributes: {
        "payout.id": candidate.id,
        "earning.id": candidate.earningHistoryId,
        ...errorIdentity(error),
      },
    });
    return false;
  }
};

const failClaimed = async (
  claimed: PayoutRecord,
  failure: PayoutFailure,
): Promise<Outcome> => {
  const delay = retryDelaySeconds(claimed.attempts);
  const exhausted = claimed.attempts >= PAYOUT_MAX_ATTEMPTS;

  const failed = await failProcessingPayoutIfAttemptsMatch(db, {
    id: claimed.id,
    attempts: claimed.attempts,
    lastError: failure.code,
    retryDelaySeconds: delay,
    idempotencyKey:
      failure.kind === "definitive"
        ? bumpIdempotencyKey(claimed.id, claimed.idempotency_key)
        : undefined,
  });

  if (!failed) {
    await logger.warn({
      message: "Payout failure not recorded",
      eventName: "payout.transition_lost",
      attributes: { ...payoutAttributes(claimed), "payout.to": "FAILED" },
    });
    return "skipped";
  }

  await logger.warn({
    message: "Payout failed",
    eventName: "payout.failed",
    attributes: {
      ...payoutAttributes(failed),
      "payout.attempts": failed.attempts,
      "payout.failure_kind": failure.kind,
      "error.code": failure.code,
    },
  });

  if (exhausted) {
    await logger.error({
      message: "Payout retries exhausted",
      eventName: "payout.exhausted",
      attributes: {
        ...payoutAttributes(failed),
        "payout.attempts": failed.attempts,
        "error.code": failure.code,
      },
    });
  }

  return "failed";
};

interface FoundTransfer {
  id: string;
  reversed: boolean;
}

const parkForReview = async (
  claimed: PayoutRecord,
  code: string,
): Promise<Outcome> => {
  const parked = await parkProcessingPayoutIfAttemptsMatch(db, {
    id: claimed.id,
    attempts: claimed.attempts,
    lastError: code,
  });

  if (!parked) {
    await logger.warn({
      message: "Payout failure not recorded",
      eventName: "payout.transition_lost",
      attributes: { ...payoutAttributes(claimed), "payout.to": "FAILED" },
    });
    return "skipped";
  }

  await logger.error({
    message: "Payout needs manual review",
    eventName: "payout.exhausted",
    attributes: {
      ...payoutAttributes(parked),
      "payout.attempts": parked.attempts,
      reason: code,
    },
  });
  return "failed";
};

const findExistingTransfer = async (
  claimed: PayoutRecord,
  amountCents: number,
  destination: string | undefined,
): Promise<FoundTransfer | undefined> => {
  const transfers = await stripe.transfers.list({
    transfer_group: `payout:${claimed.id}`,
    ...(destination ? { destination } : {}),
    limit: TRANSFER_LIST_LIMIT,
  });

  const matches = transfers.data.filter(
    (transfer) =>
      transfer.amount === amountCents &&
      transfer.currency === "usd" &&
      (destination === undefined ||
        (typeof transfer.destination === "string"
          ? transfer.destination
          : transfer.destination?.id) === destination),
  );
  const toFound = (transfer: (typeof matches)[number]): FoundTransfer => ({
    id: transfer.id,
    reversed: transfer.reversed === true || (transfer.amount_reversed ?? 0) > 0,
  });
  const live = matches.find((transfer) => !toFound(transfer).reversed);
  const chosen = live ?? matches[0];
  return chosen ? toFound(chosen) : undefined;
};

const createTransfer = async (
  claimed: PayoutRecord,
  destination: string,
  amountCents: number,
): Promise<string> => {
  const idempotencyKey =
    claimed.idempotency_key ?? initialIdempotencyKey(claimed.id);

  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination,
      transfer_group: `payout:${claimed.id}`,
      description: `OneMarketplace.io payout for earning ${claimed.earning_history_id}`,
      metadata: {
        payoutId: claimed.id,
        earningHistoryId: claimed.earning_history_id,
        ...(claimed.freelancer_id
          ? { freelancerId: claimed.freelancer_id }
          : { agencyId: claimed.agency_id! }),
      },
    },
    { idempotencyKey },
  );
  return transfer.id;
};

const processCandidate = async (candidate: Candidate): Promise<Outcome> => {
  if (!candidate.stripeConnectAccountId) return "skipped";
  const destination = candidate.stripeConnectAccountId;

  if (!(await isTransfersActive(candidate, destination))) return "skipped";

  const claimed = await claimPayoutIfClaimableSkipLocked(db, {
    id: candidate.id,
    destination,
  });
  if (!claimed) return "skipped";
  const priorClaim =
    claimed.prev_claimed_at !== null || claimed.prev_idempotency_key !== null;
  const destinationChanged =
    claimed.destination_account_id !== null &&
    claimed.destination_account_id !== destination;

  await logger.info({
    message: "Payout claimed",
    eventName: "payout.claimed",
    attributes: {
      ...payoutAttributes(claimed),
      "payout.attempts": claimed.attempts,
    },
  });

  if (candidate.status === "PROCESSING") {
    await logger.warn({
      message: "Payout recovered from a stuck claim",
      eventName: "payout.recovered",
      attributes: {
        ...payoutAttributes(claimed),
        "payout.attempts": claimed.attempts,
        reason: "stuck_takeover",
      },
    });
  }

  const amountCents = candidate.amountCents;
  let transferId: string | undefined;
  let adoptedReason: string | undefined;

  if (priorClaim) {
    let found: FoundTransfer | undefined;
    try {
      found = await findExistingTransfer(
        claimed,
        amountCents,
        destinationChanged ? undefined : destination,
      );
    } catch (error) {
      return failClaimed(claimed, {
        kind: "unknown",
        code: classifyPayoutFailure(error).code,
      });
    }
    if (found?.reversed) return parkForReview(claimed, "transfer_reversed");
    if (found) {
      transferId = found.id;
      adoptedReason = destinationChanged
        ? "adopted_transfer_other_destination"
        : "adopted_transfer";
    } else if (destinationChanged) {
      return parkForReview(claimed, "destination_changed");
    }
  }

  if (transferId === undefined) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      return parkForReview(claimed, "invalid_amount");
    }
    try {
      transferId = await createTransfer(claimed, destination, amountCents);
    } catch (error) {
      return failClaimed(claimed, classifyPayoutFailure(error));
    }
  }

  const { paid, notice } = await db.transaction(async (transaction) => {
    const written = await markProcessingPayoutPaidIfAttemptsMatch(transaction, {
      id: claimed.id,
      attempts: claimed.attempts,
      transferId,
    });
    if (!written) return { paid: undefined, notice: null };
    const inserted = await insertNotification(
      transaction,
      payoutNoticeInput(written),
    );
    await markPayoutNotifiedIfUnnotified(transaction, written.id);
    return { paid: written, notice: inserted };
  });

  if (!paid) {
    await logger.warn({
      message: "Payout paid state not recorded",
      eventName: "payout.transition_lost",
      attributes: {
        ...payoutAttributes(claimed),
        "payout.to": "PAID",
        "payment.transaction_id": transferId,
      },
    });
    return "skipped";
  }

  await logger.info({
    message: adoptedReason
      ? "Payout recovered from existing transfer"
      : "Payout sent",
    eventName: adoptedReason ? "payout.recovered" : "payout.paid",
    attributes: {
      ...payoutAttributes(paid),
      "payout.attempts": paid.attempts,
      "payment.provider": "stripe",
      "payment.amount_cents": amountCents,
      "payment.currency": "USD",
      "payment.transaction_id": transferId,
      ...(adoptedReason ? { reason: adoptedReason } : {}),
    },
  });

  await pushPayoutNotice(paid, notice);
  return "paid";
};

const runStep = async <T>(step: () => Promise<T>): Promise<T> => {
  try {
    return await step();
  } catch (error) {
    await logger.error({
      message: "Payout run failed",
      eventName: "payout.run.failed",
      attributes: { ...errorIdentity(error) },
    });
    throw error;
  }
};

const stopReason = (startedAt: number, processed: number): StoppedEarly => {
  if (Date.now() - startedAt >= PAYOUT_TICK_BUDGET_MS) return "budget";
  if (processed >= PAYOUT_MAX_PER_TICK) return "cap";
  return null;
};

const logStop = async (
  reason: Exclude<StoppedEarly, null>,
  processed: number,
): Promise<void> => {
  if (reason === "budget") {
    await logger.warn({
      message: "Payout run stopped at the time budget",
      eventName: "payout.run.budget_exhausted",
      attributes: { "payout.processed": processed },
    });
    return;
  }
  await logger.warn({
    message: "Payout run stopped at the per-tick cap",
    eventName: "payout.run.capped",
    attributes: {
      "payout.processed": processed,
      "payout.cap": PAYOUT_MAX_PER_TICK,
    },
  });
};

interface RunTally {
  processed: number;
  paid: number;
  skipped: number;
  failed: number;
}

const processBatch = async (
  candidates: Candidate[],
  startedAt: number,
  tally: RunTally,
): Promise<StoppedEarly> => {
  for (const candidate of candidates) {
    const reason = stopReason(startedAt, tally.processed);
    if (reason) {
      await logStop(reason, tally.processed);
      return reason;
    }
    tally.processed += 1;
    try {
      const outcome = await processCandidate(candidate);
      if (outcome === "paid") tally.paid += 1;
      else if (outcome === "failed") tally.failed += 1;
      else tally.skipped += 1;
    } catch (error) {
      tally.failed += 1;
      await logger.error({
        message: "Payout processing error",
        eventName: "payout.failed",
        attributes: {
          "payout.id": candidate.id,
          "earning.id": candidate.earningHistoryId,
          "payout.failure_kind": "internal",
          ...errorIdentity(error),
        },
      });
    }
  }
  return null;
};

export const processDuePayouts = async (): Promise<PayoutRunSummary> => {
  const startedAt = Date.now();
  try {
    await sweepUnnotified();
  } catch (error) {
    await logger.error({
      message: "Payout notification sweep failed",
      eventName: "payment.payout.notification_failed",
      attributes: { ...errorIdentity(error) },
    });
  }
  await runStep(createDueRows);

  const tally: RunTally = { processed: 0, paid: 0, skipped: 0, failed: 0 };
  let stoppedEarly: StoppedEarly = null;
  let cursor: CandidateCursor | undefined;

  while (stoppedEarly === null) {
    const after = cursor;
    const candidates = await runStep(() => selectCandidates(after));
    const last = candidates.at(-1);
    if (!last) break;
    stoppedEarly = await processBatch(candidates, startedAt, tally);
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  const summary: PayoutRunSummary = {
    checked: tally.processed,
    paid: tally.paid,
    skipped: tally.skipped,
    failed: tally.failed,
    stoppedEarly,
  };
  await logger.info({
    message: "Payout run complete",
    eventName: "payment.payout.run_completed",
    attributes: {
      "payout.checked": summary.checked,
      "payout.paid": summary.paid,
      "payout.skipped": summary.skipped,
      "payout.failed": summary.failed,
      "payout.stopped_early": summary.stoppedEarly ?? "none",
    },
  });

  return summary;
};
