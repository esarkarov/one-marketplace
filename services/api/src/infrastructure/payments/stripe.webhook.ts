import type { Request } from "express";
import type Stripe from "stripe";
import { ApiError } from "../../shared/errors/api-error.js";
import { stripe } from "./stripe.client.js";

export interface StripeWebhookOptions {
  secret: string | undefined;
  source: string;
  missingMessage: string;
}

const rejection = (source: string, reason: string) => ({
  message: "Webhook signature rejected",
  eventName: "webhook.inbound.rejected",
  attributes: {
    "webhook.source": source,
    "webhook.reject_reason": reason,
  },
});

export const verifyStripeWebhook = async (
  request: Request,
  { secret, source, missingMessage }: StripeWebhookOptions,
): Promise<Stripe.Event> => {
  const signature = request.headers["stripe-signature"];
  if (!secret || typeof signature !== "string") {
    await request.logger.warn(rejection(source, "missing_signature_or_secret"));
    throw new ApiError(400, missingMessage);
  }

  try {
    return stripe.webhooks.constructEvent(request.body, signature, secret);
  } catch {
    await request.logger.warn(rejection(source, "invalid_signature"));
    throw new ApiError(400, "Invalid Stripe webhook signature.");
  }
};
