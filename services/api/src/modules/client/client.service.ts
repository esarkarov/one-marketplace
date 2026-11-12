import { clerk } from "../../infrastructure/clerk.js";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import {
  accounts,
  agency_earning,
  agency_metadata,
  client_metadata,
  client_spents,
  contract_milestones,
  contracts,
  conversation_participants,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  messages,
  proposals,
  reviews,
} from "../../database/schema.js";
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
  const [profile] = await db
    .select({
      professionalRole: client_metadata.role,
      companyName: client_metadata.company_name,
      companyWebsite: client_metadata.company_website,
      companySize: client_metadata.company_size,
      industry: client_metadata.industry,
      companyDescription: client_metadata.company_description,
      joinedAt: client_metadata.created_at,
      identityVerified: accounts.identityVerified,
      paymentMethodVerified: accounts.paymentMethodVerified,
    })
    .from(client_metadata)
    .innerJoin(
      accounts,
      and(
        eq(accounts.auth_id, client_metadata.auth_id),
        eq(accounts.role, "CLIENT"),
      ),
    )
    .where(eq(client_metadata.auth_id, userId))
    .limit(1);

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
    const [account] = await transaction
      .update(accounts)
      .set({
        isOnboardingComplete: true,
        updated_at: now,
      })
      .where(
        and(eq(accounts.auth_id, input.userId), eq(accounts.role, "CLIENT")),
      )
      .returning({
        id: accounts.id,
        identityVerified: accounts.identityVerified,
        paymentMethodVerified: accounts.paymentMethodVerified,
      });

    if (!account) {
      throw new ApiError(404, "Client account not found.");
    }

    const [savedProfile] = await transaction
      .insert(client_metadata)
      .values({
        auth_id: input.userId,
        role: input.professionalRole,
        company_name: input.companyName,
        company_website: input.companyWebsite,
        company_size: input.companySize,
        industry: input.industry,
        company_description: input.companyDescription,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: client_metadata.auth_id,
        set: {
          role: input.professionalRole,
          company_name: input.companyName,
          company_website: input.companyWebsite,
          company_size: input.companySize,
          industry: input.industry,
          company_description: input.companyDescription,
          updated_at: now,
        },
      })
      .returning({
        professionalRole: client_metadata.role,
        companyName: client_metadata.company_name,
        companyWebsite: client_metadata.company_website,
        companySize: client_metadata.company_size,
        industry: client_metadata.industry,
        companyDescription: client_metadata.company_description,
        joinedAt: client_metadata?.created_at,
      });

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
  const [spend] = await db
    .select({
      totalSpentCents: client_spents.total_spent_cents,
      completedContracts: client_spents.completed_contracts,
      ongoingContracts: client_spents.ongoing_contracts,
      rating: client_spents.rating,
    })
    .from(client_spents)
    .where(eq(client_spents.client_id, clientId))
    .limit(1);

  const [openJobsRow] = await db
    .select({ value: count() })
    .from(job_posts)
    .where(
      and(eq(job_posts.client_id, clientId), eq(job_posts.status, "PUBLISHED")),
    );

  const [totalJobsRow] = await db
    .select({ value: count() })
    .from(job_posts)
    .where(eq(job_posts.client_id, clientId));

  const responseResult = await db.execute<{ avg_seconds: number | null }>(sql`
    with client_messages as (
      select
        m.sender_id,
        m.created_at,
        lag(m.sender_id) over (partition by m.conversation_id order by m.created_at) as prev_sender_id,
        lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev_created_at
      from ${messages} m
      where m.message_type = 'USER'
        and m.conversation_id in (
          select conversation_id from ${conversation_participants}
          where account_id = ${clientId}
        )
    )
    select avg(extract(epoch from (created_at - prev_created_at))) as avg_seconds
    from client_messages
    where sender_id = ${clientId}
      and prev_sender_id is not null
      and prev_sender_id <> ${clientId}
  `);
  const averageResponseSeconds = responseResult.rows[0]?.avg_seconds ?? null;

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
  const [spend] = await db
    .select({
      totalSpentCents: client_spents.total_spent_cents,
      ongoingContracts: client_spents.ongoing_contracts,
      completedContracts: client_spents.completed_contracts,
    })
    .from(client_spents)
    .where(eq(client_spents.client_id, clientId))
    .limit(1);

  const [openJobsRow] = await db
    .select({ value: count() })
    .from(job_posts)
    .where(
      and(eq(job_posts.client_id, clientId), eq(job_posts.status, "PUBLISHED")),
    );

  const [proposalStats] = await db
    .select({
      total: count(),
      submitted: sql<number>`count(*) filter (where ${proposals.status} = 'SUBMITTED')`,
      shortlisted: sql<number>`count(*) filter (where ${proposals.status} = 'SUBMITTED' and ${proposals.is_shortlisted})`,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .where(eq(job_posts.client_id, clientId));

  const contractRows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      totalAmountCents: contracts.total_amount_cents,
      completedAmountCents: sql<string>`coalesce(sum(${contract_milestones.amount_cents}) filter (where ${contract_milestones.status} = 'COMPLETED'), 0)`,
      fundedAmountCents: sql<string>`coalesce(sum(${contract_milestones.amount_cents}) filter (where ${contract_milestones.funded_at} is not null and ${contract_milestones.status} <> 'COMPLETED'), 0)`,
    })
    .from(contracts)
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .where(
      and(eq(contracts.client_id, clientId), eq(contracts.status, "ACTIVE")),
    )
    .groupBy(contracts.id, contracts.title, contracts.total_amount_cents);

  const activeJobRows = await db
    .select({
      id: job_posts.id,
      title: job_posts.title,
      budgetCents: job_posts.total_budget_cents,
      level: job_posts.expertise_level,
      duration: job_posts.expected_duration,
      proposalCount: count(proposals.id),
    })
    .from(job_posts)
    .leftJoin(proposals, eq(proposals.job_id, job_posts.id))
    .where(
      and(eq(job_posts.client_id, clientId), eq(job_posts.status, "PUBLISHED")),
    )
    .groupBy(job_posts.id)
    .orderBy(desc(job_posts.created_at))
    .limit(5);

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
  const rows = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      totalAmountCents: contracts.total_amount_cents,
      completedAt: contracts.completed_at,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
    })
    .from(contracts)
    .where(
      and(eq(contracts.client_id, clientId), eq(contracts.status, "COMPLETED")),
    )
    .orderBy(desc(contracts.completed_at));

  if (rows.length === 0) return [];

  const contractIds = rows.map((row) => row.id);
  const reviewRows = await db
    .select({
      contractId: reviews.contract_id,
      reviewerId: reviews.reviewer_id,
      rating: reviews.rating,
      comment: reviews.comment,
    })
    .from(reviews)
    .where(inArray(reviews.contract_id, contractIds));

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
    const agencyRows = await db
      .select({ id: agency_metadata.id, name: agency_metadata.name })
      .from(agency_metadata)
      .where(inArray(agency_metadata.id, agencyIds));
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

  const [account] = await db
    .select({
      stripeCustomerId: accounts.stripe_customer_id,
      email: accounts.email,
    })
    .from(accounts)
    .where(and(eq(accounts.auth_id, clientId), eq(accounts.role, "CLIENT")))
    .limit(1);

  if (!account) throw new ApiError(404, "Client account not found.");

  let customerId = account.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { accountId: clientId, role: "CLIENT" },
    });
    customerId = customer.id;
    await db
      .update(accounts)
      .set({ stripe_customer_id: customerId, updated_at: new Date() })
      .where(eq(accounts.auth_id, clientId));
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
    const rows = await db
      .select({
        id: freelancer_metadata.id,
        authId: freelancer_metadata.auth_id,
        professionalTitle: freelancer_metadata.professional_title,
        city: freelancer_metadata.city,
        country: freelancer_metadata.country,
        skills: freelancer_metadata.skills,
        identityVerified: accounts.identityVerified,
        rating: freelancer_earning.rating,
        jobSuccessScore: freelancer_earning.job_success_score,
      })
      .from(freelancer_metadata)
      .innerJoin(accounts, eq(accounts.auth_id, freelancer_metadata.auth_id))
      .leftJoin(
        freelancer_earning,
        eq(freelancer_earning.freelancer_id, freelancer_metadata.auth_id),
      )
      .limit(limit)
      .offset(offset);

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
    const rows = await db
      .select({
        id: agency_metadata.id,
        name: agency_metadata.name,
        professionalTitle: agency_metadata.professional_title,
        specialty: agency_metadata.specialty,
        tags: agency_metadata.tags,
        avatarImage: agency_metadata.avatar_image,
        identityVerified: accounts.identityVerified,
        ownerCity: freelancer_metadata.city,
        ownerCountry: freelancer_metadata.country,
        rating: agency_earning.rating,
        jobSuccessScore: agency_earning.job_success_score,
      })
      .from(agency_metadata)
      .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
      .leftJoin(
        freelancer_metadata,
        eq(freelancer_metadata.auth_id, agency_metadata.owner_id),
      )
      .leftJoin(
        agency_earning,
        eq(agency_earning.agency_id, agency_metadata.id),
      )
      .where(eq(agency_metadata.is_onboarded, true))
      .limit(limit)
      .offset(offset);

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
