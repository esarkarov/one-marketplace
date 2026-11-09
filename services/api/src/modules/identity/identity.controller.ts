import { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { stripe } from "../../config/stripe.js";
import { ApiError } from "../../utils/api-error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  completeIdentityVerification,
  createIdentitySession,
} from "./identity.service.js";

export const startIdentityVerification: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");

    const url = await createIdentitySession(
      request.auth.userId,
      request.auth.role,
      request.query.context === "agency" ? "agency" : undefined,
    );
    response.status(200).json({
      success: true,
      message: "Identity verification session created.",
      data: { url },
    });
  },
);

export const identityWebhook: RequestHandler = asyncHandler(
  async (request, response) => {
    const signature = request.headers["stripe-signature"];
    if (!env.stripeIdentityWebhookSecret || typeof signature !== "string") {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe_identity",
          "webhook.reject_reason": "missing_signature_or_secret",
        },
      });
      throw new ApiError(400, "Invalid Stripe Identity webhook.");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        signature,
        env.stripeIdentityWebhookSecret,
      );
    } catch {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe_identity",
          "webhook.reject_reason": "invalid_signature",
        },
      });
      throw new ApiError(400, "Invalid Stripe webhook signature.");
    }

    if (event.type === "identity.verification_session.verified") {
      await completeIdentityVerification(event.data.object);
    }

    response.status(200).json({ received: true });
  },
);
