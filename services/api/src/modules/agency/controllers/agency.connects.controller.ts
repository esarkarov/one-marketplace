import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { ApiResponse } from "../../../types/common.types.js";
import {
  getAgencyIdForMember,
  requireAgencyPermission,
} from "../services/agency.membership.service.js";
import {
  createAgencyConnectsCheckout,
  getAgencyConnectsBalance,
  getAgencyConnectsHistory,
  isConnectsPlan,
} from "../../connects/index.js";

export const getAgencyConnects: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    if (!agencyId) {
      throw new ApiError(
        404,
        "No agency workspace was found for this account.",
      );
    }

    const connects = await getAgencyConnectsBalance(agencyId);

    const body: ApiResponse<{ connects: number }> = {
      success: true,
      message: "Agency Connects balance retrieved.",
      data: { connects },
    };

    response.status(200).json(body);
  },
);

export const getAgencyConnectsHistoryHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    const history = agencyId
      ? await getAgencyConnectsHistory(agencyId, {
          limit: Number(request.query.limit),
          offset: Number(request.query.offset),
        })
      : { results: [], hasMore: false };

    const body: ApiResponse<typeof history> = {
      success: true,
      message: "Agency Connects history retrieved.",
      data: history,
    };

    response.status(200).json(body);
  },
);

export const buyAgencyConnects: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const { agencyId } = await requireAgencyPermission(
      request.auth.userId,
      "connects.checkout",
    );
    if (!agencyId) {
      throw new ApiError(
        404,
        "No agency workspace was found for this account.",
      );
    }

    const purchasedConnects = request.body?.connects;
    if (!isConnectsPlan(purchasedConnects)) {
      throw new ApiError(400, "Select a valid Connects package.");
    }

    const url = await createAgencyConnectsCheckout(
      request.auth.userId,
      agencyId,
      purchasedConnects,
    );

    const body: ApiResponse<{ url: string }> = {
      success: true,
      message: "Stripe Checkout created.",
      data: { url },
    };

    response.status(200).json(body);
  },
);
