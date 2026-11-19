import type Stripe from "stripe";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import { stripe } from "@/infrastructure/payments/stripe.client.js";
import { ORPHAN_PAYMENT_DETECTION } from "@/modules/contracts/constants/contracts.constants.js";
import { findRecordedCheckoutSessionIds } from "@/modules/contracts/repositories/contracts.orphan-payment.repository.js";
import { isContractPaymentSession } from "@/modules/contracts/utils/contracts.payment-session.js";

export interface OrphanDetectionSummary {
  scanned: number;
  orphans: number;
  exhausted: number;
  alreadyRefunded: number;
  skipped?: "no-stripe-key";
  aborted: boolean;
}

const HOUR_MS = 3_600_000;

const isFullyRefunded = (session: Stripe.Checkout.Session): boolean => {
  const intent = session.payment_intent;
  if (typeof intent !== "object" || intent === null) return false;
  const charge = intent.latest_charge;
  if (typeof charge !== "object" || charge === null) return false;
  return (
    intent.amount_received > 0 &&
    charge.amount_refunded >= intent.amount_received
  );
};

const paymentIntentIdOf = (session: Stripe.Checkout.Session): string | null => {
  const intent = session.payment_intent;
  if (typeof intent === "string") return intent;
  return intent?.id ?? null;
};

export const detectOrphanPaidSessions = async (
  input: { now?: Date; maxPages?: number } = {},
): Promise<OrphanDetectionSummary> => {
  const now = input.now ?? new Date();
  const maxPages = Math.max(
    1,
    Math.floor(input.maxPages ?? ORPHAN_PAYMENT_DETECTION.defaultMaxPages),
  );
  const summary: OrphanDetectionSummary = {
    scanned: 0,
    orphans: 0,
    exhausted: 0,
    alreadyRefunded: 0,
    aborted: false,
  };

  if (!env.stripeSecretKey) {
    await logger.info({
      message: "Orphan payment detection skipped: Stripe is not configured.",
      eventName: "payment.orphan.skipped",
    });
    return { ...summary, skipped: "no-stripe-key" };
  }

  const created = {
    gte: Math.floor(
      (now.getTime() - ORPHAN_PAYMENT_DETECTION.lookbackMs) / 1000,
    ),
    lte: Math.floor((now.getTime() - ORPHAN_PAYMENT_DETECTION.minAgeMs) / 1000),
  };

  let startingAfter: string | undefined;
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      summary.aborted = true;
      await logger.warn({
        message: "Orphan payment detection stopped at the page cap.",
        eventName: "payment.orphan.truncated",
        attributes: { "orphan.max_pages": maxPages },
      });
      break;
    }

    const list = await stripe.checkout.sessions.list({
      created,
      status: "complete",
      limit: ORPHAN_PAYMENT_DETECTION.pageSize,
      expand: ["data.payment_intent.latest_charge"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const candidates = list.data.filter(
      (session) =>
        session.payment_status === "paid" && isContractPaymentSession(session),
    );
    summary.scanned += candidates.length;

    const recorded = await findRecordedCheckoutSessionIds(
      db,
      candidates.map((session) => session.id),
    );

    for (const session of candidates) {
      if (recorded.has(session.id)) continue;
      if (isFullyRefunded(session)) {
        summary.alreadyRefunded += 1;
        continue;
      }
      const ageMs = now.getTime() - session.created * 1000;
      const exhausted = ageMs >= ORPHAN_PAYMENT_DETECTION.retriesExhaustedAgeMs;
      summary.orphans += 1;
      if (exhausted) summary.exhausted += 1;
      const attributes = {
        "stripe.checkout_session_id": session.id,
        "stripe.payment_intent_id": paymentIntentIdOf(session),
        "session.age_hours": Math.floor(ageMs / HOUR_MS),
        "payment.amount_cents": session.amount_total,
        "payment.currency": session.currency,
        "contract.id": session.metadata?.contractId ?? null,
      };
      if (exhausted) {
        await logger.error({
          message: "Paid checkout session has no recorded contract payment.",
          eventName: "payment.orphan.detected",
          attributes: { ...attributes, retries_exhausted: true },
        });
      } else {
        await logger.warn({
          message: "Paid checkout session has no recorded contract payment.",
          eventName: "payment.orphan.detected",
          attributes,
        });
      }
    }

    const last = list.data.at(-1);
    if (!list.has_more || !last) break;
    startingAfter = last.id;
  }

  if (summary.scanned > 0 || summary.aborted) {
    await logger.info({
      message: "Orphan payment detection run finished.",
      eventName: "payment.orphan.run",
      attributes: {
        "orphan.scanned": summary.scanned,
        "orphan.orphans": summary.orphans,
        "orphan.exhausted": summary.exhausted,
        "orphan.already_refunded": summary.alreadyRefunded,
        "orphan.aborted": summary.aborted,
      },
    });
  }
  return summary;
};
