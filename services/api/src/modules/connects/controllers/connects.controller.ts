import { RequestHandler } from "express";
import { requireFreelancer } from "../../../middleware/auth/role-guards.middleware.js";
import { ApiResponse } from "../../../types/common.types.js";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import {
  buyConnectsRequest,
  connectsHistoryRequest,
} from "../schemas/connects.schema.js";
import {
  completeAgencyConnectsPurchase,
  completeConnectsPurchase,
  createConnectsCheckout,
  getConnectsHistory,
} from "../services/connects.service.js";
import { CONNECTS_PLANS } from "../constants/connects.constants.js";
import { isConnectsPlan } from "../utils/connects.plans.js";
import { env } from "../../../config/env.js";
import { verifyStripeWebhook } from "../../../infrastructure/payments/stripe.webhook.js";

export const getAvailableConnects: RequestHandler = async (
  request,
  response,
) => {
  requireFreelancer(request);

  const body: ApiResponse<{ connects: number }> = {
    success: true,
    message: "Available Connects retrieved",
    data: { connects: request.availableConnects ?? 0 },
  };

  response.status(200).json(body);
};

export const getLoggedInFreelancerConnectsHistory: RequestHandler =
  asyncHandler(async (request, response) => {
    const auth = requireFreelancer(request);
    const { query } = getValidated(request, connectsHistoryRequest);
    const history = await getConnectsHistory(auth.userId, {
      limit: query.limit,
      offset: query.offset,
    });
    const body: ApiResponse<typeof history> = {
      success: true,
      message: "Connects history retrieved.",
      data: history,
    };

    response.status(200).json(body);
  });

export const buyConnects: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const { body } = getValidated(request, buyConnectsRequest);
    const purchasedConnects = body.connects;

    const url = await createConnectsCheckout(auth.userId, purchasedConnects);
    response.status(200).json({
      success: true,
      message: "Stripe Checkout created.",
      data: { url },
    } satisfies ApiResponse<{ url: string }>);
  },
);

export const connectsWebhook: RequestHandler = asyncHandler(
  async (request, response) => {
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

    response.status(200).json({ received: true });
  },
);
