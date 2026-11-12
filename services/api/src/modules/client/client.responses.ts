import { z } from "zod";
import {
  cents,
  ErrorBody,
  isoDateTime,
  offsetPage,
  ok,
  BadRequestBody,
} from "../../shared/validation/response-schemas.js";

const ClientProfile = z
  .strictObject({
    professionalRole: z.string(),
    companyName: z.string(),
    companyWebsite: z.string(),
    companySize: z.string(),
    industry: z.string(),
    companyDescription: z.string(),
    joinedAt: isoDateTime.nullable(),
    identityVerified: z.boolean(),
    paymentMethodVerified: z.boolean(),
  })
  .meta({ id: "ClientProfile" });

const ClientProfileSaved = ClientProfile.extend({
  isOnboarded: z.literal(true),
}).meta({ id: "ClientProfileSaved" });

const ClientHiringOverview = z
  .strictObject({
    totalSpentCents: cents,
    completedContracts: z.number().int(),
    rating: z.number(),
    openJobs: z.number().int(),
    totalHires: z.number().int(),
    hireRate: z.number().int(),
    averageResponseDays: z.number().nullable(),
  })
  .meta({ id: "ClientHiringOverview" });

const ClientDashboardOverview = z
  .strictObject({
    openJobs: z.number().int(),
    totalProposals: z.number().int(),
    newProposals: z.number().int(),
    shortlistedProposals: z.number().int(),
    activeContracts: z.number().int(),
    totalContracts: z.number().int(),
    totalSpentCents: cents,
    currentlyFundedCents: cents,
    inProgressContracts: z.array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        progressPercent: z.number().int(),
      }),
    ),
    activeJobPosts: z.array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        budgetCents: cents,
        level: z.string(),
        duration: z.string(),
        proposalCount: z.number().int(),
      }),
    ),
  })
  .meta({ id: "ClientDashboardOverview" });

const ClientReview = z.strictObject({
  rating: z.number().int(),
  text: z.string(),
});

const ClientCompletedContract = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    talent: z.string(),
    budgetCents: cents,
    completedAt: isoDateTime.nullable(),
    clientReview: ClientReview.nullable(),
    talentReview: ClientReview.nullable(),
  })
  .meta({ id: "ClientCompletedContract" });

const ClientFinanceLink = z
  .strictObject({ url: z.string() })
  .meta({ id: "ClientFinanceLink" });

const ClientMarketplaceResult = z
  .strictObject({
    id: z.uuid(),
    accountType: z.enum(["Freelancer", "Agency"]),
    name: z.string(),
    title: z.string(),
    location: z.string(),
    verified: z.boolean(),
    skills: z.array(z.string()),
    jobSuccess: z.number().int(),
    rating: z.number(),
    avatarUrl: z.string().nullable(),
  })
  .meta({ id: "ClientMarketplaceResult" });

export const clientProfileGetResponses = {
  200: ok(ClientProfile.nullable()),
  403: ErrorBody,
};

export const clientProfilePutResponses = {
  200: ok(ClientProfileSaved),
  400: BadRequestBody,
  403: ErrorBody,
  404: ErrorBody,
};

export const clientHiringOverviewResponses = {
  200: ok(ClientHiringOverview),
  403: ErrorBody,
};

export const clientCompletedContractsResponses = {
  200: ok(z.array(ClientCompletedContract)),
  403: ErrorBody,
};

export const clientDashboardOverviewResponses = {
  200: ok(ClientDashboardOverview),
  403: ErrorBody,
};

export const clientFinanceLinkResponses = {
  200: ok(ClientFinanceLink),
  403: ErrorBody,
  404: ErrorBody,
};

export const clientMarketplaceSearchResponses = {
  200: ok(offsetPage(ClientMarketplaceResult)),
  403: ErrorBody,
};
