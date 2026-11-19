import { env } from "../../../config/env.js";
import {
  verifyStripeWebhook,
  type StripeWebhookRequest,
} from "../../../infrastructure/payments/stripe.webhook.js";
import { completeIdentityVerification } from "./identity.service.js";

export const handleIdentityWebhook = async (
  request: StripeWebhookRequest,
): Promise<void> => {
  const event = await verifyStripeWebhook(request, {
    secret: env.stripeIdentityWebhookSecret,
    source: "stripe_identity",
    missingMessage: "Invalid Stripe Identity webhook.",
  });

  if (event.type === "identity.verification_session.verified") {
    await completeIdentityVerification(event.data.object);
  }
};
