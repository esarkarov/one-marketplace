import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { ApiResponse } from "../../../types/common.types.js";
import {
  getAgencyEarningsOverview,
  getAgencyMonthlyEarnings,
  getAgencyPayoutManagementUrl,
} from "../services/agency.earnings.service.js";
import { requireAgencyPermission } from "../services/agency.membership.service.js";
import { getAgencyIdentityForOwner } from "../services/agency.profile.service.js";
import { requireAgencyAuth } from "../utils/agency.auth.js";

export const getAgencyEarningsSummaryHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const { agencyId } = await requireAgencyPermission(
      request.auth.userId,
      "earnings.view",
    );
    const earnings = agencyId
      ? await getAgencyMonthlyEarnings(agencyId)
      : {
          hasEarnings: false,
          currentMonthTotalCents: 0,
          previousMonthTotalCents: 0,
          series: [],
        };

    const body: ApiResponse<typeof earnings> = {
      success: true,
      message: "Agency earnings summary retrieved.",
      data: earnings,
    };

    response.status(200).json(body);
  },
);

export const getAgencyEarningsOverviewHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const { agencyId } = await requireAgencyPermission(
      auth.userId,
      "earnings.view",
    );
    const overview = agencyId
      ? await getAgencyEarningsOverview(agencyId)
      : {
          availableCents: 0,
          pendingCents: 0,
          withdrawnCents: 0,
          lifetimeCents: 0,
          totalFeesCents: 0,
          recentEarnings: [],
        };

    const body: ApiResponse<typeof overview> = {
      success: true,
      message: "Agency earnings overview retrieved.",
      data: overview,
    };

    response.status(200).json(body);
  },
);

export const getAgencyPayoutManagementLinkHandler: RequestHandler =
  asyncHandler(async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await getAgencyIdentityForOwner(auth.userId);
    if (!agency) {
      throw new ApiError(
        403,
        "Only the agency owner can manage payout settings.",
      );
    }
    const url = await getAgencyPayoutManagementUrl(agency.id);

    const body: ApiResponse<{ url: string }> = {
      success: true,
      message: "Stripe payout management link created.",
      data: { url },
    };

    response.status(200).json(body);
  });
