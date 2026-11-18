import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { ApiResponse } from "../../../types/common.types.js";
import { requireText } from "../../../config/constants.js";
import { parseLiveUrl } from "../../../shared/uploads/portfolio-images.js";
import {
  createAgency,
  getAgencyForMember,
  getAgencyTags,
  getPublicAgencyProfile,
  updateAgencyProfile,
} from "../services/agency.profile.service.js";
import { searchPublicAgencies } from "../services/agency.search.service.js";
import {
  AgencyData,
  PublicAgencyData,
  ImageInput,
  PublicAgencyFeedPage,
  PublicAgencyFilters,
  UpdateAgencyPortfolioInput,
} from "../types/agency.types.js";
import { getMatchedJobPostsBySkills } from "../../freelancer/index.js";

const requireAgencyWebsite = (
  value: string | undefined,
): string | undefined => {
  if (!value || !value.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") throw new Error("Unsupported protocol.");
  } catch {
    throw new ApiError(400, "Agency website must be a valid HTTPS URL.");
  }

  return value.trim();
};

const parseTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const parseImageInput = (value: unknown): ImageInput | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const url = (value as { url?: unknown }).url;
  if (typeof url !== "string" || !url.trim()) return undefined;

  return { url };
};

const parsePortfolio = (value: unknown): UpdateAgencyPortfolioInput[] => {
  if (!Array.isArray(value)) return [];

  return value.map((rawItem, index) => {
    const item = rawItem as {
      title?: unknown;
      category?: unknown;
      description?: unknown;
      liveUrl?: unknown;
      coverImage?: unknown;
    };

    const coverImage = parseImageInput(item.coverImage);
    if (!coverImage) {
      throw new ApiError(
        400,
        `Portfolio project ${index + 1} needs a cover image.`,
      );
    }

    return {
      title: requireText(
        typeof item.title === "string" ? item.title : undefined,
        `Portfolio project ${index + 1} title`,
      ),
      category: requireText(
        typeof item.category === "string" ? item.category : undefined,
        `Portfolio project ${index + 1} category`,
      ),
      description: requireText(
        typeof item.description === "string" ? item.description : undefined,
        `Portfolio project ${index + 1} description`,
      ),
      liveUrl: parseLiveUrl(item.liveUrl),
      coverImage,
    };
  });
};

export const getLoggedInAgency: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agency = await getAgencyForMember(request.auth.userId);
    const body: ApiResponse<AgencyData | null> = {
      success: true,
      message: agency
        ? "Agency retrieved."
        : "No agency found for this account.",
      data: agency,
    };

    response.status(200).json(body);
  },
);

interface CreateAgencyBody {
  name?: string;
  size?: string;
  specialty?: string;
  website?: string;
  overview?: string;
}

export const createAgencyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const body = request.body as CreateAgencyBody;

    const agency = await createAgency({
      ownerId: request.auth.userId,
      name: requireText(body.name, "Agency name"),
      size: requireText(body.size, "Agency size"),
      specialty: requireText(body.specialty, "Primary specialty"),
      website: requireAgencyWebsite(body.website),
      overview: requireText(body.overview, "Agency overview"),
    });

    const responseBody: ApiResponse<AgencyData> = {
      success: true,
      message: "Agency created.",
      data: agency,
    };

    response.status(201).json(responseBody);
  },
);

interface UpdateAgencyBody {
  name?: string;
  professionalTitle?: string;
  size?: string;
  specialty?: string;
  website?: string;
  overview?: string;
  tags?: unknown;
  avatarImage?: unknown;
  portfolio?: unknown;
}

export const updateAgencyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const body = request.body as UpdateAgencyBody;

    const agency = await updateAgencyProfile({
      ownerId: request.auth.userId,
      name: requireText(body.name, "Agency name"),
      professionalTitle: requireText(body.professionalTitle, "Profile title"),
      size: requireText(body.size, "Agency size"),
      specialty: requireText(body.specialty, "Primary specialty"),
      website: requireAgencyWebsite(body.website),
      overview: requireText(body.overview, "Profile description"),
      tags: parseTags(body.tags),
      avatarImage: parseImageInput(body.avatarImage),
      portfolio: parsePortfolio(body.portfolio),
    });

    const responseBody: ApiResponse<AgencyData> = {
      success: true,
      message: "Agency profile saved.",
      data: agency,
    };

    response.status(200).json(responseBody);
  },
);

export const getAgencyJobFeed: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const tags = await getAgencyTags(request.auth.userId);
    if (tags === null) {
      throw new ApiError(
        404,
        "No agency workspace was found for this account.",
      );
    }

    const list = (value: unknown) =>
      typeof value === "string" ? value.split(",").filter(Boolean) : undefined;
    const number = (value: unknown) => {
      const parsed = Number(value);
      return value !== undefined && Number.isFinite(parsed)
        ? parsed
        : undefined;
    };

    const filters = {
      sort: request.query.filter === "recent" ? "recent" : "best-match",
      levels: list(request.query.levels),
      durations: list(request.query.durations),
      minBudgetCents: number(request.query.minBudgetCents),
      maxBudgetCents: number(request.query.maxBudgetCents),
      minProposals: number(request.query.minProposals),
      maxProposals: number(request.query.maxProposals),
      paymentVerified: request.query.paymentVerified === "true",
    } as const;

    const jobs = await getMatchedJobPostsBySkills(tags, filters, {
      limit: Number(request.query.limit),
      offset: Number(request.query.offset),
    });

    response.status(200).json({
      success: true,
      message:
        filters.sort === "recent"
          ? "Recent job posts retrieved."
          : "Matched job posts retrieved.",
      data: jobs,
    });
  },
);

export const getPublicAgencyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const profile = await getPublicAgencyProfile(
      requireText(request.params.id, "Agency"),
    );
    if (!profile) throw new ApiError(404, "Agency profile not found.");

    const body: ApiResponse<PublicAgencyData> = {
      success: true,
      message: "Agency profile retrieved.",
      data: profile,
    };

    response.status(200).json(body);
  },
);

export const searchPublicAgenciesHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const sort = (request.query.sort ??
      "recommended") as PublicAgencyFilters["sort"];
    const limit = Number(request.query.limit);
    const offset = Number(request.query.offset);
    const sizes =
      typeof request.query.sizes === "string" && request.query.sizes
        ? request.query.sizes.split(",").filter(Boolean)
        : undefined;
    const maxRateCents = Number(request.query.maxRateCents);

    const filters: PublicAgencyFilters = {
      query,
      sort,
      sizes,
      specialty:
        typeof request.query.specialty === "string" && request.query.specialty
          ? request.query.specialty
          : undefined,
      verifiedOnly: request.query.verifiedOnly === "true",
      maxRateCents:
        Number.isSafeInteger(maxRateCents) && maxRateCents > 0
          ? maxRateCents
          : undefined,
    };

    const page = await searchPublicAgencies(filters, { limit, offset });
    const responseBody: ApiResponse<PublicAgencyFeedPage> = {
      success: true,
      message: "Agency search results retrieved.",
      data: page,
    };

    response.status(200).json(responseBody);
  },
);
