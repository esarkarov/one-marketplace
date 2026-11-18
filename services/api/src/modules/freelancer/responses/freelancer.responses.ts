import { JOB_STATUSES } from "../../../shared/validation/constants/status.constants.js";
import { z } from "zod";
import {
  ErrorBody,
  offsetPage,
  ok,
  BadRequestBody,
} from "../../../shared/responses/api-envelope.responses.js";
import {
  cents,
  isoDateTime,
} from "../../../shared/responses/scalar.responses.js";

const CoverImage = z.strictObject({ imageId: z.string(), url: z.string() });

const FreelancerPortfolio = z
  .strictObject({
    id: z.uuid(),
    freelancerId: z.uuid(),
    title: z.string(),
    category: z.string(),
    description: z.string(),
    liveUrl: z.string().nullable(),
    coverImage: CoverImage,
    createdAt: isoDateTime.nullable(),
    updatedAt: isoDateTime.nullable(),
  })
  .meta({ id: "FreelancerPortfolio" });

const profileFields = {
  professionalTitle: z.string(),
  professionalDescription: z.string(),
  hourlyRateCents: cents,
  country: z.string(),
  city: z.string(),
  availabilityStatus: z.string(),
  weeklyAvailability: z.string(),
  experienceLevel: z.string(),
  skills: z.array(z.string()),
  languages: z.array(
    z.strictObject({ language: z.string(), proficiency: z.string() }),
  ),
  portfolios: z.array(FreelancerPortfolio),
  identityVerified: z.boolean(),
  joinedAt: isoDateTime.nullable(),
};

const FreelancerAgency = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

const FreelancerStats = z.strictObject({
  totalEarningCents: cents,
  completedJobs: z.number().int(),
  ongoingJobs: z.number().int(),
  reviewCount: z.number().int(),
  jobSuccessScore: z.number(),
  rating: z.number().nullable(),
});

const FreelancerWorkHistoryItem = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  client: z.string(),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  completed: isoDateTime.nullable(),
  createdAt: isoDateTime,
  amountCents: cents,
  rating: z.number().int().nullable(),
  review: z.string().nullable(),
  clientHasReviewed: z.boolean(),
  freelancerHasReviewed: z.boolean(),
  skills: z.array(z.string()),
});

const detailFields = {
  agency: FreelancerAgency.nullable(),
  stats: FreelancerStats,
  workHistory: z.array(FreelancerWorkHistoryItem),
};

const FreelancerProfile = z
  .strictObject({
    id: z.uuid(),
    createdAt: isoDateTime.nullable(),
    updatedAt: isoDateTime.nullable(),
    ...profileFields,
    ...detailFields,
  })
  .meta({ id: "FreelancerProfile" });

const FreelancerProfileSaved = z
  .strictObject(profileFields)
  .meta({ id: "FreelancerProfileSaved" });

const FreelancerPublicProfile = z
  .strictObject({
    id: z.uuid(),
    createdAt: isoDateTime.nullable(),
    updatedAt: isoDateTime.nullable(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    ...profileFields,
    ...detailFields,
  })
  .meta({ id: "FreelancerPublicProfile" });

const FreelancerTalent = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    title: z.string(),
    location: z.string(),
    verified: z.boolean(),
    active: z.boolean(),
    jobSuccess: z.number().int(),
    completedProjects: z.number().int(),
    rating: z.number(),
    reviews: z.number().int(),
    hourlyRateCents: cents,
    skills: z.array(z.string()),
    summary: z.string(),
  })
  .meta({ id: "FreelancerTalent" });

const FreelancerEarningsSummary = z
  .strictObject({
    hasEarnings: z.boolean(),
    currentMonthTotalCents: cents,
    previousMonthTotalCents: cents,
    series: z.array(z.strictObject({ month: z.string(), totalCents: cents })),
  })
  .meta({ id: "FreelancerEarningsSummary" });

const FreelancerEarningsOverview = z
  .strictObject({
    availableCents: cents,
    pendingCents: cents,
    withdrawnCents: cents,
    lifetimeCents: cents,
    totalFeesCents: cents,
    feeRatePercent: z.number(),
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
  .meta({ id: "FreelancerEarningsOverview" });

const FreelancerEarningsCertificatePdf = z.string().meta({
  id: "FreelancerEarningsCertificatePdf",
  format: "binary",
  description: "application/pdf attachment",
});

const FreelancerPayoutLink = z
  .strictObject({ url: z.string() })
  .meta({ id: "FreelancerPayoutLink" });

const jobPostFields = {
  id: z.uuid(),
  clientId: z.uuid(),
  title: z.string(),
  description: z.string(),
  expertiseLevel: z.string(),
  expectedDuration: z.string(),
  skills: z.array(z.string()),
  totalBudgetCents: cents,
  milestones: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      budgetCents: cents,
      dueDate: z.string(),
    }),
  ),
  screeningQuestions: z.array(z.string()).nullable(),
  attachments: z
    .array(
      z.strictObject({
        fileId: z.string(),
        fileName: z.string(),
        fileUrl: z.string(),
        fileType: z.string(),
        fileSize: z.number().int(),
      }),
    )
    .nullable(),
  status: z.enum(JOB_STATUSES),
  publishedAt: isoDateTime.nullable(),
  hiredAt: isoDateTime.nullable(),
  createdAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
  clientCountry: z.string().nullable(),
  paymentVerified: z.boolean(),
  proposalCount: z.number().int(),
  hireCount: z.number().int(),
  clientTotalSpentCents: cents,
  clientRating: z.number(),
  clientReviewCount: z.number().int(),
  companyName: z.string(),
};

const FreelancerJobFeedItem = z
  .strictObject({
    ...jobPostFields,
    matchScore: z.number().int().optional(),
  })
  .meta({ id: "FreelancerJobFeedItem" });

const FreelancerJobDetail = z
  .strictObject({
    ...jobPostFields,
    companyDescription: z.string(),
    clientJoinedAt: isoDateTime.nullable(),
  })
  .meta({ id: "FreelancerJobDetail" });

export const freelancerProfileGetResponses = {
  200: ok(FreelancerProfile),
  403: ErrorBody,
  404: ErrorBody,
};

export const freelancerSearchResponses = {
  200: ok(offsetPage(FreelancerTalent)),
};

export const freelancerPublicProfileResponses = {
  200: ok(FreelancerPublicProfile),
  404: ErrorBody,
};

export const freelancerProfilePutResponses = {
  200: ok(FreelancerProfileSaved),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
};

export const freelancerEarningsSummaryResponses = {
  200: ok(FreelancerEarningsSummary),
  403: ErrorBody,
};

export const freelancerEarningsOverviewResponses = {
  200: ok(FreelancerEarningsOverview),
  403: ErrorBody,
};

export const freelancerEarningsCertificateResponses = {
  200: FreelancerEarningsCertificatePdf,
  403: ErrorBody,
  404: ErrorBody,
};

export const freelancerPayoutLinkResponses = {
  200: ok(FreelancerPayoutLink),
  403: ErrorBody,
  404: ErrorBody,
};

export const freelancerJobFeedResponses = {
  200: ok(offsetPage(FreelancerJobFeedItem)),
  403: ErrorBody,
  404: ErrorBody,
};

export const freelancerJobDetailResponses = {
  200: ok(FreelancerJobDetail),
  403: ErrorBody,
  404: ErrorBody,
};
