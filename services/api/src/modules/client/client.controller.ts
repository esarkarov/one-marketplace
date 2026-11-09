import { RequestHandler } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { ApiError } from "../../utils/api-error.js";
import {
  ClientCompletedContract,
  ClientDashboardOverview,
  ClientHiringOverview,
  ClientMetadataData,
  ClientProfileData,
  getClientCompletedContracts,
  getClientDashboardOverview,
  getClientFinanceManagementUrl,
  getClientHiringOverview,
  getClientProfile,
  MarketplaceSearchPage,
  saveClientProfile,
  SaveClientProfileInput,
  searchMarketplace,
} from "./client.service.js";
import { ApiResponse } from "../../types/common.types.js";
import { requireText, requireWebsite } from "../../config/constants.js";

export const getLoggedInClientProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const profile = await getClientProfile(request.auth.userId);
    const responseBody: ApiResponse<ClientMetadataData | null> = {
      success: true,
      message: profile
        ? "Client profile retrived"
        : "Client profile has not been completed.",
      data: profile,
    };

    response.status(200).json(responseBody);
  },
);

interface ClientProfileBody {
  professionalRole?: string;
  companyName?: string;
  companyWebsite?: string | undefined;
  companySize?: string;
  industry?: string;
  companyDescription?: string;
}

export const upsertClientProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const body = request.body as ClientProfileBody;
    const input: SaveClientProfileInput = {
      userId: request.auth.userId,
      professionalRole: requireText(body.professionalRole, "Professional role"),
      companyName: requireText(body.companyName, "Company name"),
      companyWebsite: requireWebsite(body.companyWebsite),
      companySize: requireText(body.companySize, "Company size"),
      industry: requireText(body.industry, "Industry"),
      companyDescription: requireText(
        body.companyDescription,
        "Company description",
      ),
    };

    const profile = await saveClientProfile(input);
    await request.logger.info({
      message: "User updated",
      eventName: "user.updated",
      attributes: {
        "user.id": request.auth.userId,
        "user.change_kind": "profile",
      },
    });
    const responseBody: ApiResponse<ClientProfileData> = {
      success: true,
      message: "Client profile saved.",
      data: profile,
    };

    response.status(200).json(responseBody);
  },
);

export const getClientHiringOverviewHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const data = await getClientHiringOverview(request.auth.userId);
    const responseBody: ApiResponse<ClientHiringOverview> = {
      success: true,
      message: "Client hiring overview retrieved.",
      data,
    };

    response.status(200).json(responseBody);
  },
);

export const getClientDashboardOverviewHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const data = await getClientDashboardOverview(request.auth.userId);
    const responseBody: ApiResponse<ClientDashboardOverview> = {
      success: true,
      message: "Client dashboard overview retrieved.",
      data,
    };

    response.status(200).json(responseBody);
  },
);

export const getClientCompletedContractsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const data = await getClientCompletedContracts(request.auth.userId);
    const responseBody: ApiResponse<ClientCompletedContract[]> = {
      success: true,
      message: "Completed contracts retrieved.",
      data,
    };

    response.status(200).json(responseBody);
  },
);

export const getClientFinanceManagementLink: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const url = await getClientFinanceManagementUrl(request.auth.userId);

    response.status(200).json({
      success: true,
      message: "Stripe finance management link created.",
      data: { url },
    });
  },
);

export const searchMarketplaceHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "client") {
      throw new ApiError(403, "A client account is required.");
    }

    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const type =
      request.query.type === "freelancer" || request.query.type === "agency"
        ? request.query.type
        : "all";
    const offset = Math.max(0, Number(request.query.offset) || 0);

    const page = await searchMarketplace(query, type, { offset });
    const responseBody: ApiResponse<MarketplaceSearchPage> = {
      success: true,
      message: "Marketplace search results retrieved.",
      data: page,
    };

    response.status(200).json(responseBody);
  },
);
