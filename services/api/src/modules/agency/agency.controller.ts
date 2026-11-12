import { RequestHandler } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { ApiError } from "../../utils/api-error.js";
import { isValidEmail } from "../../utils/email.js";
import { ApiResponse } from "../../types/common.types.js";
import { requireText } from "../../config/constants.js";
import { parseLiveUrl } from "../../utils/portfolio-images.js";
import {
  AgencyData,
  cancelAgencyInvitation,
  createAgency,
  getAgencyEarningsOverview,
  getAgencyForMember,
  getAgencyIdentityForOwner,
  getAgencyIdForMember,
  getAgencyInvitations,
  getAgencyMonthlyEarnings,
  getAgencyOwnerVerification,
  getAgencyPayoutManagementUrl,
  getAgencyTags,
  getMyAgencyInvitations,
  getPublicAgencyProfile,
  ImageInput,
  inviteAgencyMember,
  PublicAgencyFeedPage,
  PublicAgencyFilters,
  removeAgencyMember,
  requireAgencyPermission,
  resendAgencyInvitation,
  respondToAgencyInvitation,
  searchPublicAgencies,
  updateAgencyInvitationRole,
  updateAgencyMemberRole,
  updateAgencyProfile,
  UpdateAgencyPortfolioInput,
} from "./agency.service.js";
import { getMatchedJobPostsBySkills } from "../freelancer/freelancer.service.js";
import {
  createAgencyConnectsCheckout,
  getAgencyConnectsBalance,
  getAgencyConnectsHistory,
} from "../connects/connects.service.js";
import { CONNECTS_PLANS, ConnectsPlan } from "../../config/constants.js";
import {
  getAgencyProposalMetadata,
  getAgencyProposals,
  submitAgencyProposal,
} from "../proposals/proposals.service.js";

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

    const jobs = await getMatchedJobPostsBySkills(tags, filters);

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
    const history = agencyId ? await getAgencyConnectsHistory(agencyId) : [];

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

    const purchasedConnects = Number(request.body?.connects) as ConnectsPlan;
    if (!(purchasedConnects in CONNECTS_PLANS)) {
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

export const submitAgencyProposalHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const { agencyId } = await requireAgencyPermission(
      request.auth.userId,
      "proposal.send",
    );
    if (!agencyId) {
      throw new ApiError(
        404,
        "No agency workspace was found for this account.",
      );
    }

    const coverLetter = requireText(request.body?.coverLetter, "Cover letter");
    const bidAmountCents = request.body.bidAmountCents as number;
    const screeningAnswers = Array.isArray(request.body?.screeningAnswers)
      ? request.body.screeningAnswers.map((answer: unknown) =>
          typeof answer === "string" ? answer.trim() : "",
        )
      : [];
    if (coverLetter.length < 80) {
      throw new ApiError(400, "Cover letter must be at least 80 characters.");
    }

    const result = await submitAgencyProposal(agencyId, {
      jobId: requireText(request.body?.jobId, "Job post"),
      coverLetter,
      bidAmountCents,
      duration: requireText(request.body?.duration, "Delivery duration"),
      screeningAnswers,
    });

    const body: ApiResponse<typeof result> = {
      success: true,
      message: "Proposal submitted.",
      data: result,
    };

    response.status(201).json(body);
  },
);

export const getPublicAgencyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const profile = await getPublicAgencyProfile(
      requireText(request.params.id, "Agency"),
    );
    if (!profile) throw new ApiError(404, "Agency profile not found.");

    const body: ApiResponse<AgencyData> = {
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
    const offset = Math.max(0, Number(request.query.offset) || 0);
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

    const page = await searchPublicAgencies(filters, { offset });
    const responseBody: ApiResponse<PublicAgencyFeedPage> = {
      success: true,
      message: "Agency search results retrieved.",
      data: page,
    };

    response.status(200).json(responseBody);
  },
);

export const getAgencyProposalMetadataHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    const metadata = agencyId
      ? await getAgencyProposalMetadata(agencyId)
      : {
          proposals: [],
          counts: { total: 0, active: 0, viewed: 0, interviewed: 0 },
        };

    const body: ApiResponse<typeof metadata> = {
      success: true,
      message: "Proposal metadata retrieved.",
      data: metadata,
    };

    response.status(200).json(body);
  },
);

export const getAgencyProposalsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (request.auth.role !== "freelancer") {
      throw new ApiError(403, "A freelancer account is required.");
    }

    const agencyId = await getAgencyIdForMember(request.auth.userId);
    const proposals = agencyId ? await getAgencyProposals(agencyId) : [];

    const body: ApiResponse<typeof proposals> = {
      success: true,
      message: "Proposals retrieved.",
      data: proposals,
    };

    response.status(200).json(body);
  },
);

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

const requireAgencyAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required.");
  if (request.auth.role !== "freelancer") {
    throw new ApiError(403, "A freelancer account is required.");
  }
  return request.auth;
};

const requireAgencyOwner = async (userId: string) => {
  const agency = await getAgencyIdentityForOwner(userId);
  if (!agency) {
    throw new ApiError(403, "Only the agency owner can manage the team.");
  }
  return agency;
};

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

export const getAgencyTeamInvitationsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const { agencyId } = await requireAgencyPermission(
      auth.userId,
      "team.invitations.view",
    );
    const invitations = agencyId ? await getAgencyInvitations(agencyId) : [];

    response.status(200).json({
      success: true,
      message: "Agency invitations retrieved.",
      data: invitations,
    });
  },
);

export const inviteAgencyMemberHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const email = requireText(request.body?.email, "Email").toLowerCase();
    const role = request.body?.memberRole ?? "Agency member";
    if (!isValidEmail(email)) {
      throw new ApiError(400, "Enter a valid email address.");
    }

    const invitation = await inviteAgencyMember(
      agency.id,
      agency.name,
      auth.userId,
      {
        email,
        role,
      },
    );

    response.status(201).json({
      success: true,
      message: "Invitation sent.",
      data: invitation,
    });
  },
);

export const cancelAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await cancelAgencyInvitation(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
    );

    response.status(200).json({
      success: true,
      message: "Invitation cancelled.",
      data: null,
    });
  },
);

export const updateAgencyInvitationRoleHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const role = request.body?.memberRole ?? "Agency member";

    await updateAgencyInvitationRole(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
      role,
    );

    response.status(200).json({
      success: true,
      message: "Invitation role updated.",
      data: null,
    });
  },
);

export const resendAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await resendAgencyInvitation(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
      agency.name,
    );

    response.status(200).json({
      success: true,
      message: "Invitation resent.",
      data: null,
    });
  },
);

export const updateAgencyMemberRoleHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const role = request.body?.memberRole ?? "Agency member";

    await updateAgencyMemberRole(
      agency.id,
      requireText(request.params.memberId, "Member"),
      role,
    );

    response.status(200).json({
      success: true,
      message: "Member role updated.",
      data: null,
    });
  },
);

export const removeAgencyMemberHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await removeAgencyMember(
      agency.id,
      requireText(request.params.memberId, "Member"),
    );

    response.status(200).json({
      success: true,
      message: "Member removed.",
      data: null,
    });
  },
);

export const getMyAgencyInvitationsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const invitations = await getMyAgencyInvitations(auth.userId);

    response.status(200).json({
      success: true,
      message: "Your agency invitations were retrieved.",
      data: invitations,
    });
  },
);

export const respondToAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const accept = request.body?.accept === true;

    const result = await respondToAgencyInvitation(
      requireText(request.params.invitationId, "Invitation"),
      auth.userId,
      accept,
    );

    response.status(200).json({
      success: true,
      message: accept ? "Invitation accepted." : "Invitation declined.",
      data: result,
    });
  },
);

export const getAgencyMembershipHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agencyId = await getAgencyIdForMember(auth.userId);

    response.status(200).json({
      success: true,
      message: "Agency membership retrieved.",
      data: { agencyId },
    });
  },
);

export const getAgencyVerificationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agencyId = await getAgencyIdForMember(auth.userId);
    const owner = agencyId ? await getAgencyOwnerVerification(agencyId) : null;

    const data = {
      identityVerified: owner?.identityVerified ?? false,
      isOwner: Boolean(owner && owner.ownerId === auth.userId),
    };

    response.status(200).json({
      success: true,
      message: "Agency verification status retrieved.",
      data,
    });
  },
);
