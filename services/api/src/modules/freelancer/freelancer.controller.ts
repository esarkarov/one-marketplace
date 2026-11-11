import { RequestHandler } from "express";
import { ApiError } from "../../utils/api-error.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { ApiResponse } from "../../types/common.types.js";
import { FreelancerProfileData, SaveFreelancerProfileInput } from "./@types.js";
import { requireText } from "../../config/constants.js";
import { parseLiveUrl } from "../../utils/portfolio-images.js";
import {
  getFreelancerEarningsCertificateData,
  getFreelancerEarningsOverview,
  getFreelancerJobPost,
  getFreelancerMonthlyEarnings,
  getFreelancerPayoutManagementUrl,
  getFreelancerProfile,
  getMatchedJobPosts,
  getPublicFreelancerProfile,
  PublicTalentSearchFilters,
  PublicTalentSearchPage,
  saveFreelancerProfile,
  searchPublicFreelancers,
} from "./freelancer.service.js";
import { renderEarningsCertificatePdf } from "./earnings-certificate.pdf.js";

export const requireFreelancer = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "freelancer") {
    throw new ApiError(403, "A freelancer account is required.");
  }
  return request.auth;
};

export const getLoggedInFreelancerProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const profile = await getFreelancerProfile(auth.userId);
    const body: ApiResponse<FreelancerProfileData | null> = {
      success: true,
      message: profile
        ? "Freelancer profile retrieved."
        : "Freelancer profile has not been completed.",
      data: profile,
    };
    response.status(200).json(body);
  },
);

export const upsertFreelanceProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const metadata = request.body?.freelancer_metadata as
      Record<string, any> | undefined;
    const portfolios = request?.body?.freelancer_portfolios as any;

    if (!metadata) throw new ApiError(400, "Freelancer metadata is required.");
    if (!Array.isArray(portfolios) || portfolios.length < 1) {
      throw new ApiError(400, "At least one portfolio project is required.");
    }

    const skills = metadata.skills;

    if (
      !Array.isArray(skills) ||
      skills.length < 3 ||
      skills.length > 15 ||
      skills.some(
        (skill) =>
          typeof skill !== "string" ||
          !skill.trim() ||
          skill.trim().length > 20,
      )
    ) {
      throw new ApiError(
        400,
        "Add 3 to 15 skills with at most 20 characters each.",
      );
    }

    const languages = metadata.languages;
    if (
      !Array.isArray(languages) ||
      languages.length < 1 ||
      languages.length > 5
    ) {
      throw new ApiError(400, "Add between 1 and 5 languages.");
    }

    const input: SaveFreelancerProfileInput = {
      userId: auth.userId,
      professional_title: requireText(
        metadata.professional_title,
        "Professional title",
      ),
      professional_description: requireText(
        metadata.professional_description,
        "Professional description",
      ),
      hourly_rate_cents: metadata.hourly_rate_cents as number,
      country: requireText(metadata.country, "Country"),
      city: requireText(metadata.city, "City"),
      availability_status: requireText(
        metadata.availability_status,
        "Availability status",
      ),
      weekly_availability: requireText(
        metadata.weekly_availability,
        "Weekly availability",
      ),
      experience_level: requireText(
        metadata.experience_level,
        "Experience level",
      ),
      skills: skills.map((skill) => String(skill).trim()),
      languages: languages.map((item) => {
        const language = item as Record<string, any>;
        return {
          language: requireText(language.language, "Language"),
          proficiency: requireText(
            language.proficiency,
            "Language proficiency",
          ),
        };
      }),
      portfolios: portfolios.map((item) => {
        const portfolio = item as Record<string, any>;
        const coverImage = portfolio.cover_image as
          Record<string, string> | undefined;
        if (!coverImage)
          throw new ApiError(400, "Portfolio cover image is required.");
        const imageUrl = requireText(
          coverImage.url,
          "Portfolio cover image URL",
        );

        return {
          title: requireText(portfolio.title, "Portfolio title"),
          category: requireText(portfolio.category, "Portfolio category"),
          description: requireText(
            portfolio.description,
            "Portfolio description",
          ),
          live_url: parseLiveUrl(portfolio.live_url) ?? null,
          cover_image: { url: imageUrl },
        };
      }),
    };

    const profile = await saveFreelancerProfile(
      input,
      request.auth?.isOnboarded,
    );
    await request.logger.info({
      message: "User updated",
      eventName: "user.updated",
      attributes: {
        "user.id": auth.userId,
        "user.change_kind": "profile",
      },
    });

    const body: ApiResponse<FreelancerProfileData> = {
      success: true,
      message: "Freelancer profile saved.",
      data: profile,
    };

    response.status(200).json(body);
  },
);

export const getFreelancerEarningsSummary: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const earnings = await getFreelancerMonthlyEarnings(auth.userId);

    response.status(200).json({
      success: true,
      message: "Freelancer earnings summary retrieved.",
      data: earnings,
    });
  },
);

export const getFreelancerEarningsOverviewHandler: RequestHandler =
  asyncHandler(async (request, response) => {
    const auth = requireFreelancer(request);
    const overview = await getFreelancerEarningsOverview(auth.userId);

    response.status(200).json({
      success: true,
      message: "Freelancer earnings overview retrieved.",
      data: overview,
    });
  });

export const getFreelancerEarningsCertificate: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const data = await getFreelancerEarningsCertificateData(auth.userId);
    const pdf = await renderEarningsCertificatePdf(data);
    const fileName = `OneMarketplace-Earnings-Certificate-${data.issuedAt
      .toISOString()
      .slice(0, 10)}.pdf`;

    response
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
      .send(pdf);
  },
);

export const getFreelancerPayoutManagementLink: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const url = await getFreelancerPayoutManagementUrl(auth.userId);

    response.status(200).json({
      success: true,
      message: "Stripe payout management link created.",
      data: { url },
    });
  },
);

export const getFreelancerJobFeed: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
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

    const jobs = await getMatchedJobPosts(auth.userId, filters);

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

export const getFreelancerJobDetails: RequestHandler = asyncHandler(
  async (request, response) => {
    requireFreelancer(request);
    const job = await getFreelancerJobPost(
      requireText(request.params.id, "Job ID"),
    );

    response.status(200).json({
      success: true,
      message: "Job post retrieved.",
      data: job,
    });
  },
);

export const getPublicFreelancer: RequestHandler = asyncHandler(
  async (request, response) => {
    const profile = await getPublicFreelancerProfile(
      requireText(request.params.id, "Freelancer"),
    );
    if (!profile) throw new ApiError(404, "Freelancer profile not found.");

    response.status(200).json({
      success: true,
      message: "Freelancer profile retrieved.",
      data: profile,
    });
  },
);

const SORT_VALUES = [
  "recommended",
  "rating",
  "success",
  "projects",
  "rate-low",
];

export const searchPublicFreelancersHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const sort =
      typeof request.query.sort === "string" &&
      SORT_VALUES.includes(request.query.sort)
        ? (request.query.sort as PublicTalentSearchFilters["sort"])
        : "recommended";
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const numberParam = (key: string) => {
      const value = Number(request.query[key]);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };

    const filters: PublicTalentSearchFilters = {
      query,
      sort,
      verifiedOnly: request.query.verifiedOnly === "true",
      availableOnly: request.query.availableOnly === "true",
      minRating: numberParam("minRating"),
      minSuccess: numberParam("minSuccess"),
      minRateCents: numberParam("minRateCents"),
      maxRateCents: numberParam("maxRateCents"),
    };

    const page = await searchPublicFreelancers(filters, { offset });
    const responseBody: ApiResponse<PublicTalentSearchPage> = {
      success: true,
      message: "Talent search results retrieved.",
      data: page,
    };

    response.status(200).json(responseBody);
  },
);
