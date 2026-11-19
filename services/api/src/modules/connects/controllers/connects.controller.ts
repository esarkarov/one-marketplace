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
  createConnectsCheckout,
  getConnectsHistory,
} from "../services/connects.service.js";
import { handleConnectsWebhook } from "../services/connects.webhook.service.js";

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
    await handleConnectsWebhook(request);

    response.status(200).json({ received: true });
  },
);
