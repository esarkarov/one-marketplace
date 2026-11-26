import type Stripe from "stripe";
import { logger } from "@/config/logger.js";
import { stripe } from "./stripe.client.js";

export type RefundReason = "duplicate" | "requested_by_customer";

export const paymentIntentIdOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;

const isChargeAlreadyRefunded = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "charge_already_refunded";

interface RefundTarget {
  checkoutSessionId: string | null;
  paymentIntentId: string;
  amountCents: number | null;
}

class RefundNotCompletedError extends Error {
  override name = "RefundNotCompletedError";
}

const UNSETTLED_REFUND_STATUSES = new Set<string | null>([
  "failed",
  "canceled",
]);

export const refundTarget = async (
  target: RefundTarget,
  reason: RefundReason,
  cause: string,
  options: { rejectUnsettled?: boolean; keySuffix?: string } = {},
): Promise<Stripe.Response<Stripe.Refund> | null> => {
  const { paymentIntentId } = target;
  const attributes = {
    "stripe.checkout_session_id": target.checkoutSessionId,
    "stripe.payment_intent_id": paymentIntentId,
    "payment.refund_cause": cause,
    "payment.amount_cents": target.amountCents,
  };

  let refund: Stripe.Response<Stripe.Refund>;
  try {
    refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason },
      {
        idempotencyKey: `refund:${paymentIntentId}:${reason}${options.keySuffix ?? ""}`,
      },
    );
    if (
      options.rejectUnsettled &&
      UNSETTLED_REFUND_STATUSES.has(refund.status)
    ) {
      throw new RefundNotCompletedError(`Refund ${refund.status}.`);
    }
  } catch (error) {
    if (isChargeAlreadyRefunded(error)) return null;
    await logger.error({
      message: "Payment refund failed.",
      eventName: "payment.refund.failed",
      attributes: {
        ...attributes,
        "error.name": error instanceof Error ? error.name : "UnknownError",
      },
    });
    throw error;
  }

  await logger.warn({
    message: "Payment refunded.",
    eventName: "payment.refunded",
    attributes,
  });
  return refund;
};
