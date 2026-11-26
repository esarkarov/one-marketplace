import type Stripe from "stripe";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { db } from "@/database/client.js";
import { isForeignKeyViolation } from "@/database/pg-errors.js";
import { stripe } from "@/infrastructure/payments/stripe.client.js";
import {
  isPermanentRefundCode,
  stripeErrorFields,
} from "@/infrastructure/payments/stripe.errors.js";
import {
  paymentIntentIdOf,
  refundTarget,
} from "@/infrastructure/payments/stripe.refunds.js";
import {
  verifyStripeWebhook,
  type StripeWebhookRequest,
} from "@/infrastructure/payments/stripe.webhook.js";
import {
  CONNECTS_OWNER_FOREIGN_KEYS,
  CONNECTS_PLANS,
  CONNECTS_REFUND,
} from "@/modules/connects/constants/connects.constants.js";
import { findPurchaseIdByPaymentId } from "@/modules/connects/repositories/connects.repository.js";
import { isConnectsPlan } from "@/modules/connects/utils/connects.plans.js";
import {
  completeAgencyConnectsPurchase,
  completeConnectsPurchase,
} from "./connects.service.js";

type OwnerAttributes = { "user.id": string } | { "team.id": string };

class PaymentIntentUnavailableError extends Error {
  override name = "PaymentIntentUnavailableError";
}

const isPermanentCreditFailure = (error: unknown) =>
  CONNECTS_OWNER_FOREIGN_KEYS.some((constraint) =>
    isForeignKeyViolation(error, constraint),
  );

const resolvePaymentIntentId = async (
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<string> => {
  const fromEvent = paymentIntentIdOf(session);
  if (fromEvent) return fromEvent;

  const retrieved = paymentIntentIdOf(
    await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["payment_intent"],
    }),
  );
  if (retrieved) return retrieved;

  await logger.error({
    message: "Payment could not be refunded: payment intent is missing.",
    eventName: "payment.refund.no_payment_intent",
    attributes: {
      "stripe.checkout_session_id": session.id,
      "stripe.event_id": eventId,
    },
  });
  throw new PaymentIntentUnavailableError(
    "Payment intent could not be resolved.",
  );
};

const refundUncreditedPurchase = async (
  session: Stripe.Checkout.Session,
  eventId: string,
  owner: OwnerAttributes,
): Promise<void> => {
  const [credited] = await findPurchaseIdByPaymentId(db, session.id);
  if (credited) return;

  await logger.error({
    message: "Paid Connects checkout session cannot be credited. Refunding.",
    eventName: "payment.unfulfillable",
    attributes: {
      "stripe.checkout_session_id": session.id,
      "stripe.payment_intent_id": paymentIntentIdOf(session) ?? null,
      "payment.unfulfillable_reason": CONNECTS_REFUND.cause,
      ...owner,
    },
  });

  const paymentIntentId = await resolvePaymentIntentId(session, eventId);
  try {
    await refundTarget(
      {
        checkoutSessionId: session.id,
        paymentIntentId,
        amountCents: session.amount_total,
      },
      CONNECTS_REFUND.reason,
      CONNECTS_REFUND.cause,
      { keySuffix: CONNECTS_REFUND.keySuffix },
    );
  } catch (error) {
    const { code } = stripeErrorFields(error);
    if (!isPermanentRefundCode(code)) throw error;
    await logger.error({
      message: "Payment refund is permanently unrecoverable.",
      eventName: "payment.refund.unrecoverable",
      attributes: {
        "stripe.event_id": eventId,
        "stripe.payment_intent_id": paymentIntentId,
        "error.code": code,
      },
    });
  }
};

const creditOrRefund = async (
  credit: () => Promise<void>,
  session: Stripe.Checkout.Session,
  eventId: string,
  owner: OwnerAttributes,
): Promise<boolean> => {
  try {
    await credit();
    return true;
  } catch (error) {
    if (!isPermanentCreditFailure(error)) throw error;
    await refundUncreditedPurchase(session, eventId, owner);
    return false;
  }
};

export const handleConnectsWebhook = async (
  request: StripeWebhookRequest,
): Promise<void> => {
  const event = await verifyStripeWebhook(request, {
    secret: env.stripeConnectsWebhookSecret,
    source: "stripe",
    missingMessage: "Invalid Stripe webhook.",
  });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const purchasedConnects = Number(session.metadata?.purchasedConnects);
    const freelancerId = session.metadata?.freelancerId;
    const agencyId = session.metadata?.agencyId;

    if (
      session.payment_status === "paid" &&
      isConnectsPlan(purchasedConnects)
    ) {
      if (freelancerId) {
        const credited = await creditOrRefund(
          () =>
            completeConnectsPurchase(
              freelancerId,
              purchasedConnects,
              session.id,
            ),
          session,
          event.id,
          { "user.id": freelancerId },
        );
        if (!credited) return;

        await request.logger.info({
          message: "Payment succeeded",
          eventName: "payment.charge.succeeded",
          attributes: {
            "payment.provider": "stripe",
            "payment.amount_cents": CONNECTS_PLANS[purchasedConnects],
            "payment.currency": "USD",
            "user.id": freelancerId,
            "payment.transaction_id": session.id,
          },
        });
      } else if (agencyId) {
        const credited = await creditOrRefund(
          () =>
            completeAgencyConnectsPurchase(
              agencyId,
              purchasedConnects,
              session.id,
            ),
          session,
          event.id,
          { "team.id": agencyId },
        );
        if (!credited) return;

        await request.logger.info({
          message: "Payment succeeded",
          eventName: "payment.charge.succeeded",
          attributes: {
            "payment.provider": "stripe",
            "payment.amount_cents": CONNECTS_PLANS[purchasedConnects],
            "payment.currency": "USD",
            "team.id": agencyId,
            "payment.transaction_id": session.id,
          },
        });
      }
    }
  }
};
