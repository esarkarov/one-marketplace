import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { EARNINGS_HOLD_PERIOD_MS } from "../../config/constants.js";
import { stripe } from "../../config/stripe.js";
import { db } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  earning_history,
  payout_history,
} from "../../database/schema.js";
import { sendNotification } from "../../events/publisher.js";
import { logger } from "../../config/logger.js";

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "23505";

export type PayoutRunSummary = {
  checked: number;
  paid: number;
  skipped: number;
  failed: number;
};

type DuePayoutRow = {
  earningHistoryId: string;
  amount: string;
  platformFeeAmount: string;
  stripeConnectAccountId: string | null;
  recipient:
    | { kind: "freelancer"; freelancerId: string }
    | { kind: "agency"; agencyId: string };
};

export const processDuePayouts = async (): Promise<PayoutRunSummary> => {
  const runId = Date.now();
  const cutoff = new Date(Date.now() - EARNINGS_HOLD_PERIOD_MS);

  const freelancerRows = await db
    .select({
      earningHistoryId: earning_history.id,
      amount: earning_history.amount,
      platformFeeAmount: earning_history.platform_fee_amount,
      stripeConnectAccountId: accounts.stripe_connect_account_id,
      freelancerId: earning_history.freelancer_id,
    })
    .from(earning_history)
    .innerJoin(accounts, eq(accounts.auth_id, earning_history.freelancer_id))
    .leftJoin(
      payout_history,
      eq(payout_history.earning_history_id, earning_history.id),
    )
    .where(
      and(
        lte(earning_history.created_at, cutoff),
        isNull(payout_history.id),
        isNotNull(earning_history.freelancer_id),
      ),
    );

  const agencyRows = await db
    .select({
      earningHistoryId: earning_history.id,
      amount: earning_history.amount,
      platformFeeAmount: earning_history.platform_fee_amount,
      stripeConnectAccountId: agency_metadata.stripe_connect_account_id,
      agencyId: earning_history.agency_id,
    })
    .from(earning_history)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, earning_history.agency_id),
    )
    .leftJoin(
      payout_history,
      eq(payout_history.earning_history_id, earning_history.id),
    )
    .where(
      and(
        lte(earning_history.created_at, cutoff),
        isNull(payout_history.id),
        isNotNull(earning_history.agency_id),
      ),
    );

  const dueRows: DuePayoutRow[] = [
    ...freelancerRows.map((row) => ({
      earningHistoryId: row.earningHistoryId,
      amount: row.amount,
      platformFeeAmount: row.platformFeeAmount,
      stripeConnectAccountId: row.stripeConnectAccountId,
      recipient: {
        kind: "freelancer" as const,
        freelancerId: row.freelancerId!,
      },
    })),
    ...agencyRows.map((row) => ({
      earningHistoryId: row.earningHistoryId,
      amount: row.amount,
      platformFeeAmount: row.platformFeeAmount,
      stripeConnectAccountId: row.stripeConnectAccountId,
      recipient: { kind: "agency" as const, agencyId: row.agencyId! },
    })),
  ];

  let paid = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of dueRows) {
    const netAmount =
      Math.round((Number(row.amount) - Number(row.platformFeeAmount)) * 100) /
      100;

    if (netAmount <= 0) {
      skipped += 1;
      continue;
    }

    if (!row.stripeConnectAccountId) {
      skipped += 1;
      continue;
    }

    // A freshly-created (or not-yet-fully-onboarded) Connect account can
    // have stripe_transfers "requested" without it being "active" yet —
    // Stripe rejects the transfer outright in that state. Check first so
    // that case is a normal skip-and-retry-later, not a logged failure.
    let transfersActive = false;
    try {
      const destinationAccount = await stripe.v2.core.accounts.retrieve(
        row.stripeConnectAccountId,
        { include: ["configuration.recipient"] },
      );
      transfersActive =
        destinationAccount.configuration?.recipient?.capabilities
          ?.stripe_balance?.stripe_transfers?.status === "active";
    } catch (error) {
      console.error(
        `[payouts] Could not check destination account status for earning ${row.earningHistoryId}:`,
        error,
      );
    }

    if (!transfersActive) {
      skipped += 1;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(netAmount * 100),
          currency: "usd",
          destination: row.stripeConnectAccountId,
          description: `OneMarketplace.io payout for earning ${row.earningHistoryId}`,
          metadata:
            row.recipient.kind === "freelancer"
              ? {
                  earningHistoryId: row.earningHistoryId,
                  freelancerId: row.recipient.freelancerId,
                }
              : {
                  earningHistoryId: row.earningHistoryId,
                  agencyId: row.recipient.agencyId,
                },
        },
        {
          idempotencyKey: `payout:${row.earningHistoryId}:${row.stripeConnectAccountId}:${runId}`,
        },
      );

      await db.insert(payout_history).values({
        freelancer_id:
          row.recipient.kind === "freelancer"
            ? row.recipient.freelancerId
            : null,
        agency_id:
          row.recipient.kind === "agency" ? row.recipient.agencyId : null,
        earning_history_id: row.earningHistoryId,
        amount: netAmount.toFixed(2),
        stripe_transfer_id: transfer.id,
      });

      paid += 1;

      await logger.info({
        message: "Payout sent",
        eventName: "payment.payout.succeeded",
        attributes: {
          "payment.provider": "stripe",
          "payment.amount": netAmount,
          "payment.currency": "USD",
          "payment.transaction_id": transfer.id,
          ...(row.recipient.kind === "freelancer"
            ? { "user.id": row.recipient.freelancerId }
            : { "team.id": row.recipient.agencyId }),
        },
      });

      try {
        await sendNotification(
          row.recipient.kind === "freelancer"
            ? {
                recipientId: row.recipient.freelancerId,
                type: "PAYOUT_COMPLETED",
                title: "Payment sent",
                message: `The payment of $${netAmount.toFixed(2)} is ready for withdrawal now.`,
                link: "/settings?section=earnings",
                metadata: {
                  earningHistoryId: row.earningHistoryId,
                  amount: netAmount,
                  stripeTransferId: transfer.id,
                },
              }
            : {
                agencyId: row.recipient.agencyId,
                type: "PAYOUT_COMPLETED",
                title: "Payment sent",
                message: `The payment of $${netAmount.toFixed(2)} is ready for withdrawal now.`,
                link: "/finances?section=withdrawals",
                metadata: {
                  earningHistoryId: row.earningHistoryId,
                  amount: netAmount,
                  stripeTransferId: transfer.id,
                },
              },
        );
      } catch (notificationError) {
        console.error(
          `[payouts] Notification failed for earning ${row.earningHistoryId}:`,
          notificationError,
        );
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skipped += 1;
        continue;
      }
      failed += 1;
      await logger.error({
        message: "Payout failed",
        eventName: "payment.payout.failed",
        attributes: {
          "payment.provider": "stripe",
          "payment.amount": netAmount,
          "payment.currency": "USD",
          "error.type": error instanceof Error ? error.name : "UnknownError",
          ...(row.recipient.kind === "freelancer"
            ? { "user.id": row.recipient.freelancerId }
            : { "team.id": row.recipient.agencyId }),
        },
      });
      console.error(
        `[payouts] Transfer failed for earning ${row.earningHistoryId}:`,
        error,
      );
    }
  }

  const summary: PayoutRunSummary = {
    checked: dueRows.length,
    paid,
    skipped,
    failed,
  };
  console.log(
    `[payouts] Run complete — checked: ${summary.checked}, paid: ${summary.paid}, skipped: ${summary.skipped}, failed: ${summary.failed}`,
  );

  return summary;
};
