import { RequestHandler } from "express";
import { requireFreelancer } from "../freelancer/freelancer.controller.js";
import { ApiResponse } from "../../types/common.types.js";
import { asyncHandler } from "../../utils/async-handler.js";
import {
  completeAgencyConnectsPurchase,
  completeConnectsPurchase,
  createConnectsCheckout,
  getConnectsHistory,
} from "./connects.service.js";
import { CONNECTS_PLANS, ConnectsPlan } from "../../config/constants.js";
import { ApiError } from "../../utils/api-error.js";
import { env } from "../../config/env.js";
import { stripe } from "../../config/stripe.js";

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
    const history = await getConnectsHistory(auth.userId);
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
    const purchasedConnects = Number(request.body?.connects) as ConnectsPlan;

    if (!(purchasedConnects in CONNECTS_PLANS)) {
      throw new ApiError(400, "Select a valid Connects package.");
    }

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
    const signature = request.headers["stripe-signature"];
    if (!env.stripeConnectsWebhookSecret || typeof signature !== "string") {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe",
          "webhook.reject_reason": "missing_signature_or_secret",
        },
      });
      throw new ApiError(400, "Invalid Stripe webhook.");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body,
        signature,
        env.stripeConnectsWebhookSecret,
      );
    } catch (error) {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "stripe",
          "webhook.reject_reason": "invalid_signature",
        },
      });
      throw error;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const purchasedConnects = Number(
        session.metadata?.purchasedConnects,
      ) as ConnectsPlan;
      const freelancerId = session.metadata?.freelancerId;
      const agencyId = session.metadata?.agencyId;

      if (
        session.payment_status === "paid" &&
        purchasedConnects in CONNECTS_PLANS
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
              "payment.amount": CONNECTS_PLANS[purchasedConnects],
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
              "payment.amount": CONNECTS_PLANS[purchasedConnects],
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
