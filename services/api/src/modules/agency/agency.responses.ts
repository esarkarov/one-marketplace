import { z } from "zod";
import {
  cents,
  ErrorBody,
  isoDateTime,
  offsetPage,
  ok,
  BadRequestBody,
} from "../../shared/validation/response-schemas.js";

const ResendCooldown = z
  .strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.literal("INVITATION_RESEND_COOLDOWN"),
  })
  .meta({ id: "AgencyInvitationResendCooldown" });

const errorWithCodes = <const T extends readonly [string, ...string[]]>(
  codes: T,
) =>
  z.strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.enum(codes),
  });

const PermissionDenied = z.strictObject({
  success: z.literal(false),
  message: z.string(),
  code: z.literal("AGENCY_PERMISSION_DENIED").optional(),
});

const StoredImage = z.strictObject({ imageId: z.string(), url: z.string() });

const AgencyPortfolioItem = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  liveUrl: z.string().nullable(),
  coverImage: StoredImage,
});

const AgencyMember = z.strictObject({
  id: z.uuid(),
  freelancerId: z.string(),
  profileId: z.uuid().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  skills: z.array(z.string()),
  isOwner: z.boolean(),
  rating: z.number(),
  jobSuccessScore: z.number(),
  completedProjects: z.number().int(),
});

const AgencyWorkHistoryItem = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  client: z.string(),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  completed: isoDateTime.nullable(),
  amountCents: cents,
  rating: z.number().int().nullable(),
  review: z.string().nullable(),
  clientHasReviewed: z.boolean(),
  freelancerHasReviewed: z.boolean(),
});

const AgencyProfile = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    professionalTitle: z.string().nullable(),
    size: z.string(),
    specialty: z.string(),
    website: z.string().nullable(),
    overview: z.string(),
    tags: z.array(z.string()),
    avatarImage: StoredImage.nullable(),
    isOnboarded: z.boolean(),
    portfolio: z.array(AgencyPortfolioItem),
    ownerLocation: z.string().nullable(),
    ownerLanguages: z.array(z.string()),
    ownerLanguageDetails: z.array(
      z.strictObject({ language: z.string(), proficiency: z.string() }),
    ),
    members: z.array(AgencyMember),
    createdAt: isoDateTime.nullable(),
    stats: z.strictObject({
      totalEarningCents: cents,
      completedJobs: z.number().int(),
      ongoingJobs: z.number().int(),
      reviewCount: z.number().int(),
      jobSuccessScore: z.number(),
      rating: z.number().nullable(),
    }),
    workHistory: z.array(AgencyWorkHistoryItem),
  })
  .meta({ id: "AgencyProfile" });

const AgencySummary = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    verified: z.boolean(),
    tagline: z.string().nullable(),
    description: z.string(),
    specialty: z.string(),
    location: z.string().nullable(),
    teamSize: z.string(),
    memberCount: z.number().int(),
    minHourlyRateCents: cents.nullable(),
    rating: z.number(),
    reviews: z.number().int(),
    projects: z.number().int(),
    success: z.number().int(),
    skills: z.array(z.string()),
  })
  .meta({ id: "AgencySummary" });

const AgencyMembership = z
  .strictObject({ agencyId: z.uuid().nullable() })
  .meta({ id: "AgencyMembership" });

const AgencyVerification = z
  .strictObject({ identityVerified: z.boolean(), isOwner: z.boolean() })
  .meta({ id: "AgencyVerification" });

const AgencyJobFeedItem = z
  .strictObject({
    id: z.uuid(),
    client_id: z.string(),
    title: z.string(),
    description: z.string(),
    expertise_level: z.string(),
    expected_duration: z.string(),
    skills: z.array(z.string()),
    total_budget_cents: cents,
    milestones: z.array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        budgetCents: cents,
        dueDate: z.string(),
      }),
    ),
    screening_questions: z.array(z.string()).nullable(),
    attachments: z
      .array(
        z.strictObject({
          fileId: z.string(),
          fileName: z.string(),
          fileUrl: z.string(),
          fileType: z.string(),
          fileSize: z.number(),
        }),
      )
      .nullable(),
    status: z.string(),
    published_at: isoDateTime.nullable(),
    hired_at: isoDateTime.nullable(),
    created_at: isoDateTime.nullable(),
    updated_at: isoDateTime.nullable(),
    companyName: z.string(),
    clientCountry: z.string().nullable(),
    paymentVerified: z.boolean(),
    proposalCount: z.number().int(),
    hireCount: z.number().int(),
    clientTotalSpentCents: cents,
    clientRating: z.number(),
    clientReviewCount: z.number().int(),
    matchScore: z.number().int().optional(),
  })
  .meta({ id: "AgencyJobFeedItem" });

const AgencyConnectsBalance = z
  .strictObject({ connects: z.number().int() })
  .meta({ id: "AgencyConnectsBalance" });

const AgencyConnectsHistoryItem = z
  .strictObject({
    id: z.uuid(),
    type: z.string(),
    description: z.string(),
    amount: z.number().int(),
    created_at: isoDateTime.nullable(),
  })
  .meta({ id: "AgencyConnectsHistoryItem" });

const AgencyUrl = z.strictObject({ url: z.string() }).meta({ id: "AgencyUrl" });

const AgencyProposalListItem = z
  .strictObject({
    id: z.uuid(),
    jobId: z.uuid(),
    title: z.string(),
    company: z.string().nullable(),
    status: z.string(),
    submittedAt: isoDateTime.nullable(),
    budgetCents: cents,
    bidAmountCents: cents,
    duration: z.string(),
    coverLetter: z.string(),
    skills: z.array(z.string()),
    clientRating: z.string().nullable(),
    clientReviewCount: z.number().int().nullable(),
    clientTotalSpentCents: cents.nullable(),
    conversationId: z.uuid().nullable(),
  })
  .meta({ id: "AgencyProposalListItem" });

const AgencyProposalRow = z.strictObject({
  id: z.uuid(),
  job_id: z.uuid(),
  sender_id: z.string(),
  sender_type: z.string(),
  cover_letter: z.string(),
  bid_amount_cents: cents,
  duration: z.string(),
  screening_answers: z.array(
    z.strictObject({ question: z.string(), answer: z.string() }),
  ),
  status: z.string(),
  is_shortlisted: z.boolean(),
  created_at: isoDateTime.nullable(),
  updated_at: isoDateTime.nullable(),
});

const AgencyProposalSubmitted = z
  .strictObject({
    proposal: AgencyProposalRow,
    connects: z.number().int(),
    clientId: z.string(),
    jobTitle: z.string(),
    agencyName: z.string(),
  })
  .meta({ id: "AgencyProposalSubmitted" });

const AgencyProposalMetadata = z
  .strictObject({
    proposals: z.array(
      z.strictObject({
        jobId: z.uuid(),
        status: z.string(),
        submittedAt: isoDateTime.nullable(),
      }),
    ),
    counts: z.strictObject({
      total: z.number().int(),
      active: z.number().int(),
      viewed: z.number().int(),
      interviewed: z.number().int(),
    }),
  })
  .meta({ id: "AgencyProposalMetadata" });

const AgencyEarningsSummary = z
  .strictObject({
    hasEarnings: z.boolean(),
    currentMonthTotalCents: cents,
    previousMonthTotalCents: cents,
    series: z.array(z.strictObject({ month: z.string(), totalCents: cents })),
  })
  .meta({ id: "AgencyEarningsSummary" });

const AgencyEarningsOverview = z
  .strictObject({
    availableCents: cents,
    pendingCents: cents,
    withdrawnCents: cents,
    lifetimeCents: cents,
    totalFeesCents: cents,
    recentEarnings: z.array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        client: z.string(),
        grossAmountCents: cents,
        platformFeeCents: cents,
        amountCents: cents,
        date: isoDateTime,
        availableAt: isoDateTime,
        status: z.enum(["AVAILABLE", "PENDING", "WITHDRAWN"]),
      }),
    ),
  })
  .meta({ id: "AgencyEarningsOverview" });

const AgencyInvitation = z
  .strictObject({
    id: z.uuid(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    createdAt: isoDateTime,
    avatarUrl: z.null(),
  })
  .meta({ id: "AgencyInvitation" });

const AgencyMyInvitation = z
  .strictObject({
    id: z.uuid(),
    agencyId: z.uuid(),
    agencyName: z.string(),
    agencyAvatar: StoredImage.nullable(),
    role: z.string(),
    createdAt: isoDateTime,
  })
  .meta({ id: "AgencyMyInvitation" });

const AgencyInvitationResponse = z
  .strictObject({ accepted: z.boolean() })
  .meta({ id: "AgencyInvitationResponse" });

const nullData = ok(z.null());

export const agencySearchResponses = {
  200: ok(offsetPage(AgencySummary)),
};

export const agencyPublicProfileResponses = {
  200: ok(AgencyProfile),
  404: ErrorBody,
};

export const agencyMineResponses = {
  200: ok(AgencyProfile.nullable()),
  403: ErrorBody,
};

export const agencyMembershipResponses = {
  200: ok(AgencyMembership),
  403: ErrorBody,
};

export const agencyVerificationResponses = {
  200: ok(AgencyVerification),
  403: ErrorBody,
};

export const agencyCreateResponses = {
  201: ok(AgencyProfile),
  400: BadRequestBody,
  403: ErrorBody,
  409: errorWithCodes(["ALREADY_IN_AGENCY"]),
};

export const agencyUpdateResponses = {
  200: ok(AgencyProfile),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyJobFeedResponses = {
  200: ok(z.array(AgencyJobFeedItem)),
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyConnectsResponses = {
  200: ok(AgencyConnectsBalance),
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyConnectsHistoryResponses = {
  200: ok(z.array(AgencyConnectsHistoryItem)),
  403: ErrorBody,
};

export const agencyConnectsCheckoutResponses = {
  200: ok(AgencyUrl),
  400: BadRequestBody,
  403: PermissionDenied,
  404: ErrorBody,
};

export const agencyProposalsResponses = {
  200: ok(z.array(AgencyProposalListItem)),
  403: ErrorBody,
};

export const agencySubmitProposalResponses = {
  201: ok(AgencyProposalSubmitted),
  400: BadRequestBody,
  403: PermissionDenied,
  404: ErrorBody,
  409: ErrorBody,
};

export const agencyProposalMetadataResponses = {
  200: ok(AgencyProposalMetadata),
  403: ErrorBody,
};

export const agencyEarningsSummaryResponses = {
  200: ok(AgencyEarningsSummary),
  403: PermissionDenied,
};

export const agencyEarningsOverviewResponses = {
  200: ok(AgencyEarningsOverview),
  403: PermissionDenied,
};

export const agencyPayoutLinkResponses = {
  200: ok(AgencyUrl),
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyTeamInvitationsResponses = {
  200: ok(z.array(AgencyInvitation)),
  403: PermissionDenied,
};

export const agencyInviteResponses = {
  201: ok(AgencyInvitation),
  400: BadRequestBody,
  403: ErrorBody,
  409: errorWithCodes(["INVITEE_ALREADY_MEMBER", "INVITATION_ALREADY_PENDING"]),
};

export const agencyInvitationMutationResponses = {
  200: nullData,
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyResendInvitationResponses = {
  200: nullData,
  403: ErrorBody,
  404: ErrorBody,
  429: ResendCooldown,
};

export const agencyMemberMutationResponses = {
  200: nullData,
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
};

export const agencyMyInvitationsResponses = {
  200: ok(z.array(AgencyMyInvitation)),
  403: ErrorBody,
};

export const agencyRespondResponses = {
  200: ok(AgencyInvitationResponse),
  403: ErrorBody,
  404: ErrorBody,
  409: errorWithCodes(["INVITATION_ALREADY_HANDLED", "ALREADY_IN_AGENCY"]),
};
