import { clerk } from "../../infrastructure/clerk.js";
import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import {
  markClientOnboardingComplete,
  setStripeCustomerId,
} from "../auth/auth.public.js";
import {
  countJobsOfClient,
  countPublishedJobsOfClient,
  findActiveContractProgressRows,
  findAgencyNamesByIds,
  findAverageResponseSeconds,
  findClientBillingAccount,
  findClientProfile,
  findClientSpendForDashboard,
  findClientSpendForOverview,
  findCompletedContractsOfClient,
  findFreelancerSearchRows,
  findLatestPublishedJobsWithProposalCounts,
  findOnboardedAgencySearchRows,
  findProposalStatsOfClient,
  findReviewsForContracts,
  upsertClientMetadata,
} from "./client.repository.js";
import { ApiError } from "../../shared/http/api-error.js";
import { env } from "../../config/env.js";
import { stripe } from "../../infrastructure/stripe.js";
import { invalidateAccountAuthCache } from "../../infrastructure/account-auth-cache.js";

export interface SaveClientProfileInput {
  userId: string;
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
}

export interface ClientMetadataData {
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
  joinedAt: Date | null;
  identityVerified: boolean;
  paymentMethodVerified: boolean;
}

export interface ClientProfileData extends ClientMetadataData {
  isOnboarded: true;
}

export const getClientProfile = async (
  userId: string,
): Promise<ClientMetadataData | null> => {
  const profile = await findClientProfile(db, userId);

  if (!profile) return null;

  return {
    ...profile,
    identityVerified: profile.identityVerified === true,
    paymentMethodVerified: profile.paymentMethodVerified === true,
  };
};

export const saveClientProfile = async (
  input: SaveClientProfileInput,
): Promise<ClientProfileData> => {
  const now = new Date();

  const profile: any = await db.transaction(async (transaction) => {
    const account = await markClientOnboardingComplete(
      transaction,
      input.userId,
      now,
    );

    if (!account) {
      throw new ApiError(404, "Client account not found.");
    }

    const savedProfile = await upsertClientMetadata(transaction, input, now);

    if (!savedProfile) {
      throw new ApiError(500, "Client profile could not be saved.");
    }

    return {
      ...savedProfile,
      identityVerified: account.identityVerified === true,
      paymentMethodVerified: account.paymentMethodVerified === true,
    };
  });

  await invalidateAccountAuthCache(input.userId);

  return {
    ...profile,
    isOnboarded: true,
  };
};

export interface ClientHiringOverview {
  totalSpentCents: number;
  completedContracts: number;
  rating: number;
  openJobs: number;
  totalHires: number;
  hireRate: number;
  averageResponseDays: number | null;
}

export const getClientHiringOverview = async (
  clientId: string,
): Promise<ClientHiringOverview> => {
  const spend = await findClientSpendForOverview(db, clientId);

  const openJobsRow = await countPublishedJobsOfClient(db, clientId);

  const totalJobsRow = await countJobsOfClient(db, clientId);

  const responseRows = await findAverageResponseSeconds(db, clientId);
  const averageResponseSeconds = responseRows[0]?.avg_seconds ?? null;

  const totalHires =
    (spend?.completedContracts ?? 0) + (spend?.ongoingContracts ?? 0);
  const totalJobs = totalJobsRow?.value ?? 0;

  return {
    totalSpentCents: spend?.totalSpentCents ?? 0,
    completedContracts: spend?.completedContracts ?? 0,
    rating: Number(spend?.rating ?? 0),
    openJobs: openJobsRow?.value ?? 0,
    totalHires,
    hireRate:
      totalJobs > 0
        ? Math.min(100, Math.round((totalHires / totalJobs) * 100))
        : 0,
    averageResponseDays:
      averageResponseSeconds != null
        ? Number(averageResponseSeconds) / 86400
        : null,
  };
};

export interface ClientDashboardOverview {
  openJobs: number;
  totalProposals: number;
  newProposals: number;
  shortlistedProposals: number;
  activeContracts: number;
  totalContracts: number;
  totalSpentCents: number;
  currentlyFundedCents: number;
  inProgressContracts: Array<{
    id: string;
    title: string;
    progressPercent: number;
  }>;
  activeJobPosts: Array<{
    id: string;
    title: string;
    budgetCents: number;
    level: string;
    duration: string;
    proposalCount: number;
  }>;
}

export const getClientDashboardOverview = async (
  clientId: string,
): Promise<ClientDashboardOverview> => {
  const spend = await findClientSpendForDashboard(db, clientId);

  const openJobsRow = await countPublishedJobsOfClient(db, clientId);

  const proposalStats = await findProposalStatsOfClient(db, clientId);

  const contractRows = await findActiveContractProgressRows(db, clientId);

  const activeJobRows = await findLatestPublishedJobsWithProposalCounts(
    db,
    clientId,
  );

  const currentlyFundedCents = contractRows.reduce(
    (sum, row) => sum + toSafeCents(row.fundedAmountCents),
    0,
  );

  return {
    openJobs: openJobsRow?.value ?? 0,
    totalProposals: proposalStats?.total ?? 0,
    newProposals: Number(proposalStats?.submitted ?? 0),
    shortlistedProposals: Number(proposalStats?.shortlisted ?? 0),
    activeContracts: spend?.ongoingContracts ?? 0,
    totalContracts:
      (spend?.ongoingContracts ?? 0) + (spend?.completedContracts ?? 0),
    totalSpentCents: spend?.totalSpentCents ?? 0,
    currentlyFundedCents,
    inProgressContracts: contractRows.map((row) => ({
      id: row.id,
      title: row.title,
      progressPercent:
        row.totalAmountCents > 0
          ? Math.round(
              (toSafeCents(row.completedAmountCents) / row.totalAmountCents) *
                100,
            )
          : 0,
    })),
    activeJobPosts: activeJobRows.map((row) => ({
      id: row.id,
      title: row.title,
      budgetCents: row.budgetCents,
      level: row.level,
      duration: row.duration,
      proposalCount: row.proposalCount,
    })),
  };
};

export interface ClientCompletedContract {
  id: string;
  title: string;
  talent: string;
  budgetCents: number;
  completedAt: string | null;
  clientReview: { rating: number; text: string } | null;
  talentReview: { rating: number; text: string } | null;
}

export const getClientCompletedContracts = async (
  clientId: string,
): Promise<ClientCompletedContract[]> => {
  const rows = await findCompletedContractsOfClient(db, clientId);

  if (rows.length === 0) return [];

  const contractIds = rows.map((row) => row.id);
  const reviewRows = await findReviewsForContracts(db, contractIds);

  const reviewsByContract = new Map<string, typeof reviewRows>();
  for (const review of reviewRows) {
    const list = reviewsByContract.get(review.contractId) ?? [];
    list.push(review);
    reviewsByContract.set(review.contractId, list);
  }

  const freelancerIds = [
    ...new Set(
      rows
        .map((row) => row.freelancerId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const names = new Map<string, string>();
  if (env.clerkSecretKey && freelancerIds.length) {
    await Promise.all(
      freelancerIds.map(async (freelancerId) => {
        try {
          const user = await clerk.users.getUser(freelancerId);
          names.set(
            freelancerId,
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              "Marketplace user",
          );
        } catch {
          names.set(freelancerId, "Marketplace user");
        }
      }),
    );
  }

  const agencyIds = [
    ...new Set(
      rows.map((row) => row.agencyId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const agencyNames = new Map<string, string>();
  if (agencyIds.length) {
    const agencyRows = await findAgencyNamesByIds(db, agencyIds);
    agencyRows.forEach((row) => agencyNames.set(row.id, row.name ?? "Agency"));
  }

  return rows.map((row) => {
    const contractReviews = reviewsByContract.get(row.id) ?? [];
    const clientReviewRow = contractReviews.find(
      (review) => review.reviewerId === clientId,
    );
    const talentReviewRow = contractReviews.find(
      (review) => review.reviewerId !== clientId,
    );
    const talentName = row.freelancerId
      ? (names.get(row.freelancerId) ?? "Marketplace user")
      : row.agencyId
        ? (agencyNames.get(row.agencyId) ?? "Agency")
        : "Marketplace user";

    return {
      id: row.id,
      title: row.title,
      talent: talentName,
      budgetCents: row.totalAmountCents,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      clientReview: clientReviewRow
        ? { rating: clientReviewRow.rating, text: clientReviewRow.comment }
        : null,
      talentReview: talentReviewRow
        ? { rating: talentReviewRow.rating, text: talentReviewRow.comment }
        : null,
    };
  });
};

export const getClientFinanceManagementUrl = async (
  clientId: string,
): Promise<string> => {
  if (!env.stripeSecretKey || !env.clientDashboard) {
    throw new ApiError(503, "Finance management is not configured.");
  }

  const account = await findClientBillingAccount(db, clientId);

  if (!account) throw new ApiError(404, "Client account not found.");

  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { accountId: clientId, role: "CLIENT" },
    });
    customerId = customer.id;
    await setStripeCustomerId(db, clientId, customerId);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.clientDashboard}/settings?section=finances`,
  });

  return session.url;
};

export interface MarketplaceSearchResult {
  id: string;
  accountType: "Freelancer" | "Agency";
  name: string;
  title: string;
  location: string;
  verified: boolean;
  skills: string[];
  jobSuccess: number;
  rating: number;
  avatarUrl: string | null;
}

const MARKETPLACE_SEARCH_PAGE_SIZE = 20;
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export interface MarketplaceSearchPage {
  results: MarketplaceSearchResult[];
  hasMore: boolean;
}

export const searchMarketplace = async (
  query: string,
  type: "all" | "freelancer" | "agency",
  pagination: { limit?: number; offset?: number } = {},
): Promise<MarketplaceSearchPage> => {
  const limit = pagination.limit ?? MARKETPLACE_SEARCH_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = query.trim().toLowerCase();
  const results: MarketplaceSearchResult[] = [];
  let hasMore = false;

  if (type === "all" || type === "freelancer") {
    const rows = await findFreelancerSearchRows(db, { limit, offset });

    if (rows.length === limit) hasMore = true;

    if (rows.length && env.clerkSecretKey) {
      const clerkUsers = await Promise.all(
        rows.map(async (row) => {
          try {
            return await clerk.users.getUser(row.authId);
          } catch {
            return null;
          }
        }),
      );

      rows.forEach((row, index) => {
        const user = clerkUsers[index];
        const name = user?.fullName ?? "Freelancer";
        const countryName = row.country
          ? (regionNames.of(row.country) ?? row.country)
          : null;
        const location =
          [row.city, countryName].filter(Boolean).join(", ") ||
          "Location unavailable";
        const searchable = [
          name,
          row.professionalTitle,
          location,
          ...row.skills,
        ]
          .join(" ")
          .toLowerCase();
        if (normalizedQuery && !searchable.includes(normalizedQuery)) return;

        results.push({
          id: row.id,
          accountType: "Freelancer",
          name,
          title: row.professionalTitle || "Freelancer",
          location,
          verified: row.identityVerified === true,
          skills: row.skills,
          jobSuccess: Math.round(Number(row.jobSuccessScore ?? 0)),
          rating: Number(row.rating ?? 0),
          avatarUrl: user?.imageUrl || null,
        });
      });
    }
  }

  if (type === "all" || type === "agency") {
    const rows = await findOnboardedAgencySearchRows(db, { limit, offset });

    if (rows.length === limit) hasMore = true;

    for (const row of rows) {
      const title = row.professionalTitle || row.specialty;
      const ownerCountryName = row.ownerCountry
        ? (regionNames.of(row.ownerCountry) ?? row.ownerCountry)
        : null;
      const location = [row.ownerCity, ownerCountryName]
        .filter(Boolean)
        .join(", ");
      const searchable = [row.name, title, row.specialty, location, ...row.tags]
        .join(" ")
        .toLowerCase();
      if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;

      results.push({
        id: row.id,
        accountType: "Agency",
        name: row.name,
        title,
        location,
        verified: row.identityVerified === true,
        skills: row.tags,
        jobSuccess: Math.round(Number(row.jobSuccessScore ?? 0)),
        rating: Number(row.rating ?? 0),
        avatarUrl: row.avatarImage?.url ?? null,
      });
    }
  }

  return { results, hasMore };
};
