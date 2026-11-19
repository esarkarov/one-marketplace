import { env } from "@/config/env.js";
import {
  verifyStripeWebhook,
  type StripeWebhookRequest,
} from "@/infrastructure/payments/stripe.webhook.js";
import { fundContractMilestoneFromPayment } from "./contracts.checkout.service.js";
import { runWithWebhookEvent } from "@/modules/contracts/utils/contracts.webhook-context.js";
import { createContractFromPayment } from "./contracts.lifecycle.service.js";
import { CONTRACT_PAYMENT_TYPES } from "@/modules/contracts/utils/contracts.payment-session.js";

export const handleContractWebhook = async (
  request: StripeWebhookRequest,
): Promise<void> => {
  const event = await verifyStripeWebhook(request, {
    secret: env.stripeWebhookSecret,
    source: "stripe",
    missingMessage: "Invalid Stripe webhook.",
  });

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    await runWithWebhookEvent(event.id, () =>
      session.metadata?.paymentType === CONTRACT_PAYMENT_TYPES.funding
        ? fundContractMilestoneFromPayment(session)
        : createContractFromPayment(session),
    );
  }
};
