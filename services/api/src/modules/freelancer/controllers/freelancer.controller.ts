import { RequestHandler } from "express";
import { ApiError } from "../../../shared/errors/api-error.js";
import { requireFreelancer } from "../../../middleware/auth/role-guards.middleware.js";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { ApiResponse } from "../../../types/common.types.js";
import {
  PublicTalentSearchFilters,
  PublicTalentSearchPage,
  SaveFreelancerProfileInput,
} from "../types/freelancer.types.js";
import { requireText } from "../../../config/constants.js";
import type { UpsertProfileBody } from "../schemas/freelancer.schema.js";
import { parseLiveUrl } from "../../../shared/uploads/portfolio-images.js";
import {
  getFreelancerEarningsCertificateData,
  getFreelancerEarningsOverview,
  getFreelancerMonthlyEarnings,
  getFreelancerPayoutManagementUrl,
} from "../services/freelancer.earnings.service.js";
import {
  getFreelancerJobPost,
  getMatchedJobPosts,
} from "../services/freelancer.jobs.service.js";
import {
  getFreelancerProfile,
  getPublicFreelancerProfile,
  saveFreelancerProfile,
} from "../services/freelancer.profile.service.js";
import { searchPublicFreelancers } from "../services/freelancer.search.service.js";
import {
  toFreelancerProfileResponse,
  toFreelancerProfileSavedResponse,
} from "../utils/freelancer.mappers.js";
import { renderEarningsCertificatePdf } from "../utils/earnings-certificate.pdf.js";

export const getLoggedInFreelancerProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const profile = await getFreelancerProfile(auth.userId);
    if (!profile) {
      throw new ApiError(
        404,
        "Freelancer profile has not been completed.",
        "PROFILE_NOT_FOUND",
      );
    }

    const body: ApiResponse<ReturnType<typeof toFreelancerProfileResponse>> = {
      success: true,
      message: "Freelancer profile retrieved.",
      data: profile,
    };
    response.status(200).json(body);
  },
);

export const upsertFreelanceProfile: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireFreelancer(request);
    const metadata: UpsertProfileBody["freelancerMetadata"] | undefined =
      request.body?.freelancerMetadata;
    const portfolios: UpsertProfileBody["freelancerPortfolios"] =
      request?.body?.freelancerPortfolios;

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
        metadata.professionalTitle,
        "Professional title",
      ),
      professional_description: requireText(
        metadata.professionalDescription,
        "Professional description",
      ),
      hourly_rate_cents: metadata.hourlyRateCents as number,
      country: requireText(metadata.country, "Country"),
      city: requireText(metadata.city, "City"),
      availability_status: requireText(
        metadata.availabilityStatus,
        "Availability status",
      ),
      weekly_availability: requireText(
        metadata.weeklyAvailability,
        "Weekly availability",
      ),
      experience_level: requireText(
        metadata.experienceLevel,
        "Experience level",
      ),
      skills: skills.map((skill) => String(skill).trim()),
      languages: languages.map((item) => {
        const language = item;
        return {
          language: requireText(language.language, "Language"),
          proficiency: requireText(
            language.proficiency,
            "Language proficiency",
          ),
        };
      }),
      portfolios: portfolios.map((item) => {
        const portfolio = item;
        const coverImage = portfolio.coverImage as
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
          live_url: parseLiveUrl(portfolio.liveUrl) ?? null,
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

    const body: ApiResponse<
      ReturnType<typeof toFreelancerProfileSavedResponse>
    > = {
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

export const searchPublicFreelancersHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    const sort = (request.query.sort ??
      "recommended") as PublicTalentSearchFilters["sort"];
    const limit = Number(request.query.limit);
    const offset = Number(request.query.offset);
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

    const page = await searchPublicFreelancers(filters, { limit, offset });
    const responseBody: ApiResponse<PublicTalentSearchPage> = {
      success: true,
      message: "Talent search results retrieved.",
      data: page,
    };

    response.status(200).json(responseBody);
  },
);
