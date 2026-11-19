import { RequestHandler } from "express";
import { env } from "../../../config/env.js";
import { verifyStripeWebhook } from "../../../infrastructure/payments/stripe.webhook.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import {
  completeIdentityVerification,
  createIdentitySession,
} from "../services/identity.service.js";

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
    const event = await verifyStripeWebhook(request, {
      secret: env.stripeIdentityWebhookSecret,
      source: "stripe_identity",
      missingMessage: "Invalid Stripe Identity webhook.",
    });

    if (event.type === "identity.verification_session.verified") {
      await completeIdentityVerification(event.data.object);
    }

    response.status(200).json({ received: true });
  },
);
