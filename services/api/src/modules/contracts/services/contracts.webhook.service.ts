import { env } from "@/config/env.js";
import {
  verifyStripeWebhook,
  type StripeWebhookRequest,
} from "@/infrastructure/payments/stripe.webhook.js";
import { fundContractMilestoneFromPayment } from "./contracts.checkout.service.js";
import { createContractFromPayment } from "./contracts.lifecycle.service.js";

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
    if (
      event.data.object.metadata?.paymentType === "CONTRACT_MILESTONE_FUNDING"
    ) {
      await fundContractMilestoneFromPayment(event.data.object);
    } else {
      await createContractFromPayment(event.data.object);
    }
  }
};
