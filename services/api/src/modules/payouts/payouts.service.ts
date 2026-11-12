import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { EARNINGS_HOLD_PERIOD_MS } from "../../config/constants.js";
import { stripe } from "../../infrastructure/stripe.js";
import { db } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  payout_history,
} from "../../database/schema.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";
import { logger } from "../../config/logger.js";
import { formatUsd } from "../../shared/money/money.js";
import { uuidV5 } from "../../shared/ids/uuid-v5.js";
import {
  bumpIdempotencyKey,
  classifyPayoutFailure,
  initialIdempotencyKey,
  PAYOUT_MAX_ATTEMPTS,
  retryDelaySeconds,
  type PayoutFailure,
} from "./payouts.failure.js";
import {
  claimableCondition,
  claimPayout,
  transitionPayout,
  type PayoutRecord,
} from "./payouts.state.js";

const NOTIFICATION_SWEEP_LIMIT = 300;
const TRANSFER_LIST_LIMIT = 10;

export type PayoutRunSummary = {
  checked: number;
  paid: number;
  skipped: number;
  failed: number;
};

type Outcome = "paid" | "skipped" | "failed";

type Candidate = {
  id: string;
  earningHistoryId: string;
  amountCents: number;
  status: string;
  freelancerId: string | null;
  agencyId: string | null;
  stripeConnectAccountId: string | null;
};

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

const notifyPaid = async (row: PayoutRecord): Promise<void> => {
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
  };

  const result = await sendNotification(
    row.freelancer_id
      ? {
          ...base,
          recipientId: row.freelancer_id,
          link: "/settings?section=earnings",
        }
      : {
          ...base,
          agencyId: row.agency_id!,
          link: "/finances?section=withdrawals",
        },
  );

  if (result !== "published" && result !== "disabled") {
    await logger.warn({
      message: "Payout notification not published, will retry",
      eventName: "payment.payout.notification_failed",
      attributes: payoutAttributes(row),
    });
    return;
  }

  await db
    .update(payout_history)
    .set({ notified_at: sql`now()` })
    .where(
      and(eq(payout_history.id, row.id), isNull(payout_history.notified_at)),
    );
};

const notifySafely = async (row: PayoutRecord): Promise<void> => {
  try {
    await notifyPaid(row);
  } catch (error) {
    await logger.error({
      message: "Payout notification failed",
      eventName: "payment.payout.notification_failed",
      attributes: { ...payoutAttributes(row), ...errorIdentity(error) },
    });
  }
};

const sweepUnnotified = async (): Promise<void> => {
  const rows = await db
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

  for (const row of rows) {
    await notifySafely(row);
  }
};

const createDueRows = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - EARNINGS_HOLD_PERIOD_MS);

  await db.execute(sql`
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

const selectCandidates = async (): Promise<Candidate[]> =>
  db
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
    .orderBy(asc(payout_history.created_at))
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        earningHistoryId: row.earningHistoryId,
        amountCents: row.amountCents,
        status: row.status,
        freelancerId: row.freelancerId,
        agencyId: row.agencyId,
        stripeConnectAccountId: row.freelancerId
          ? row.freelancerAccountId
          : row.agencyAccountId,
      })),
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

  const failed = await transitionPayout({
    id: claimed.id,
    from: "PROCESSING",
    to: "FAILED",
    expectedAttempts: claimed.attempts,
    set: {
      last_error: failure.code,
      next_retry_at:
        delay === null
          ? null
          : sql`now() + (${delay}::int * interval '1 second')`,
      ...(failure.kind === "definitive"
        ? {
            idempotency_key: bumpIdempotencyKey(
              claimed.id,
              claimed.idempotency_key,
            ),
          }
        : {}),
    },
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

type FoundTransfer = { id: string; reversed: boolean };

const parkForReview = async (
  claimed: PayoutRecord,
  code: string,
): Promise<Outcome> => {
  const parked = await transitionPayout({
    id: claimed.id,
    from: "PROCESSING",
    to: "FAILED",
    expectedAttempts: claimed.attempts,
    set: { last_error: code, next_retry_at: null },
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

  const claimed = await claimPayout({ id: candidate.id, destination });
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

  const paid = await transitionPayout({
    id: claimed.id,
    from: "PROCESSING",
    to: "PAID",
    expectedAttempts: claimed.attempts,
    set: {
      stripe_transfer_id: transferId,
      paid_at: sql`now()`,
      last_error: null,
      next_retry_at: null,
    },
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

  await notifySafely(paid);
  return "paid";
};

export const processDuePayouts = async (): Promise<PayoutRunSummary> => {
  try {
    await sweepUnnotified();
  } catch (error) {
    await logger.error({
      message: "Payout notification sweep failed",
      eventName: "payment.payout.notification_failed",
      attributes: { ...errorIdentity(error) },
    });
  }
  await createDueRows();
  const candidates = await selectCandidates();

  let paid = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const outcome = await processCandidate(candidate);
      if (outcome === "paid") paid += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
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

  const summary: PayoutRunSummary = {
    checked: candidates.length,
    paid,
    skipped,
    failed,
  };
  await logger.info({
    message: "Payout run complete",
    eventName: "payment.payout.run_completed",
    attributes: {
      "payout.checked": summary.checked,
      "payout.paid": summary.paid,
      "payout.skipped": summary.skipped,
      "payout.failed": summary.failed,
    },
  });

  return summary;
};
