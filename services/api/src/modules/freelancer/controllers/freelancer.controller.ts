import { RequestHandler } from "express";
import { ApiError } from "@/shared/errors/api-error.js";
import { requireFreelancer } from "@/middleware/auth/role-guards.middleware.js";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import {
  freelancerJobDetailsRequest,
  jobFeedRequest,
  publicFreelancerRequest,
  talentSearchRequest,
  upsertProfileRequest,
} from "@/modules/freelancer/schemas/freelancer.schema.js";
import { ApiResponse } from "@/types/common.types.js";
import {
  PublicTalentSearchFilters,
  PublicTalentSearchPage,
  SaveFreelancerProfileInput,
} from "@/modules/freelancer/types/freelancer.types.js";
import { requireText } from "@/shared/validation/utils/require-text.utils.js";
import type { UpsertProfileBody } from "@/modules/freelancer/schemas/freelancer.schema.js";
import { parseLiveUrl } from "@/shared/uploads/portfolio-images.js";
import {
  getFreelancerEarningsCertificateData,
  getFreelancerEarningsOverview,
  getFreelancerMonthlyEarnings,
  getFreelancerPayoutManagementUrl,
} from "@/modules/freelancer/services/freelancer.earnings.service.js";
import {
  getFreelancerJobPost,
  getMatchedJobPosts,
} from "@/modules/freelancer/services/freelancer.jobs.service.js";
import {
  getFreelancerProfile,
  getPublicFreelancerProfile,
  saveFreelancerProfile,
} from "@/modules/freelancer/services/freelancer.profile.service.js";
import { searchPublicFreelancers } from "@/modules/freelancer/services/freelancer.search.service.js";
import {
  toFreelancerProfileResponse,
  toFreelancerProfileSavedResponse,
} from "@/modules/freelancer/utils/freelancer.mappers.js";
import { renderEarningsCertificatePdf } from "@/modules/freelancer/utils/earnings-certificate.pdf.js";

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
    const { body: requestBody } = getValidated(request, upsertProfileRequest);
    const metadata: UpsertProfileBody["freelancerMetadata"] | undefined =
      requestBody.freelancerMetadata;
    const portfolios: UpsertProfileBody["freelancerPortfolios"] =
      requestBody.freelancerPortfolios;

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
      hourly_rate_cents: metadata.hourlyRateCents,
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

    const { query } = getValidated(request, jobFeedRequest);
    const filters = {
      sort: query.filter === "recent" ? "recent" : "best-match",
      levels: list(query.levels),
      durations: list(query.durations),
      minBudgetCents: number(query.minBudgetCents),
      maxBudgetCents: number(query.maxBudgetCents),
      minProposals: number(query.minProposals),
      maxProposals: number(query.maxProposals),
      paymentVerified: query.paymentVerified === "true",
    } as const;

    const jobs = await getMatchedJobPosts(auth.userId, filters, {
      limit: query.limit,
      offset: query.offset,
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

export const getFreelancerJobDetails: RequestHandler = asyncHandler(
  async (request, response) => {
    requireFreelancer(request);
    const { params } = getValidated(request, freelancerJobDetailsRequest);
    const job = await getFreelancerJobPost(requireText(params.id, "Job ID"));

    response.status(200).json({
      success: true,
      message: "Job post retrieved.",
      data: job,
    });
  },
);

export const getPublicFreelancer: RequestHandler = asyncHandler(
  async (request, response) => {
    const { params } = getValidated(request, publicFreelancerRequest);
    const profile = await getPublicFreelancerProfile(
      requireText(params.id, "Freelancer"),
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
    const { query: input } = getValidated(request, talentSearchRequest);
    const query = input.query ?? "";
    const sort = input.sort ?? "recommended";
    const { limit, offset } = input;
    const numberParam = (raw: unknown) => {
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };

    const filters: PublicTalentSearchFilters = {
      query,
      sort,
      verifiedOnly: input.verifiedOnly === "true",
      availableOnly: input.availableOnly === "true",
      minRating: numberParam(input.minRating),
      minSuccess: numberParam(input.minSuccess),
      minRateCents: numberParam(input.minRateCents),
      maxRateCents: numberParam(input.maxRateCents),
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
