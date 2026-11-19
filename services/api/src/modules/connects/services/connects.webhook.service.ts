import { env } from "../../../config/env.js";
import {
  verifyStripeWebhook,
  type StripeWebhookRequest,
} from "../../../infrastructure/payments/stripe.webhook.js";
import { CONNECTS_PLANS } from "../constants/connects.constants.js";
import { isConnectsPlan } from "../utils/connects.plans.js";
import {
  completeAgencyConnectsPurchase,
  completeConnectsPurchase,
} from "./connects.service.js";

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
        await completeConnectsPurchase(
          freelancerId,
          purchasedConnects,
          session.id,
        );

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
        await completeAgencyConnectsPurchase(
          agencyId,
          purchasedConnects,
          session.id,
        );

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
