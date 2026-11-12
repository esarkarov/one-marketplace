import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  earning_history,
  freelancer_earning,
  freelancer_metadata,
  freelancer_portfolios,
  job_posts,
  payout_history,
  proposals,
  reviews,
} from "../../database/schema.js";
import {
  FreelancerProfileData,
  PortfolioData,
  SaveFreelancerProfileInput,
} from "./freelancer.types.js";
import { getAgencyIdentityForMember } from "./freelancer.agency-identity.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import { stripe } from "../../infrastructure/stripe.js";
import { ApiError } from "../../shared/http/api-error.js";
import { imageKit } from "../../infrastructure/image-kit.js";
import { randomUUID } from "crypto";
import {
  EARNINGS_HOLD_PERIOD_MS,
  PLATFORM_FEE_BPS,
  STRIPE_PAYOUT_ELIGIBLE_COUNTRIES,
} from "../../config/constants.js";
import { invalidateAccountAuthCache } from "../../infrastructure/account-auth-cache.js";
import { addConnects } from "../connects/connects.public.js";
import { clerk } from "../../infrastructure/clerk.js";
import {
  isImageDataUrl,
  reuseStoredImage,
} from "../../shared/uploads/portfolio-images.js";

const getClientCountry = async (clientId: string) => {
  if (!env.clerkSecretKey) {
    throw new ApiError(503, "Authentication is not configured.");
  }

  const client = await clerk.users.getUser(clientId);
  const country = client.unsafeMetadata.country;

  return typeof country === "string" ? country : null;
};

export const getJSSContribution = (rating: number): number => {
  const r = Math.round(rating);
  if (r >= 5) return 100;
  if (r === 4) return 90;
  if (r === 3) return 75;
  if (r === 2) return 60;
  if (r === 1) return 50;
  return 0;
};

export const getFreelancerProfile = async (
  userId: string,
): Promise<FreelancerProfileData | null> => {
  const [result] = await db
    .select()
    .from(freelancer_metadata)
    .innerJoin(
      accounts,
      and(
        eq(accounts.auth_id, freelancer_metadata.auth_id),
        eq(accounts.role, "FREELANCER"),
      ),
    )
    .where(eq(freelancer_metadata.auth_id, userId))
    .limit(1);

  if (!result) return null;

  const profile = result.freelancer_metadata;

  const portfolios = await db
    .select()
    .from(freelancer_portfolios)
    .where(eq(freelancer_portfolios.freelancer_id, profile.id));

  const [earningStats] = await db
    .select({
      totalEarningCents: freelancer_earning.total_earning_cents,
      completedJobs: freelancer_earning.completed_jobs,
      ongoingJobs: freelancer_earning.ongoing_jobs,
      reviewCount: freelancer_earning.review_count,
      jobSuccessScore: freelancer_earning.job_success_score,
      rating: freelancer_earning.rating,
    })
    .from(freelancer_earning)
    .where(eq(freelancer_earning.freelancer_id, userId))
    .limit(1);

  const userContracts = await db
    .select({
      contract: contracts,
      companyName: client_metadata.company_name,
      skills: job_posts.skills,
    })
    .from(contracts)
    .innerJoin(
      client_metadata,
      eq(contracts.client_id, client_metadata.auth_id),
    )
    .leftJoin(job_posts, eq(contracts.job_id, job_posts.id))
    .where(
      and(
        eq(contracts.freelancer_id, userId),
        inArray(contracts.status, ["ACTIVE", "COMPLETED"]),
      ),
    )
    .orderBy(desc(contracts.updated_at));

  const workHistory = await Promise.all(
    userContracts.map(async ({ contract, companyName, skills }) => {
      const contractReviews = await db
        .select({
          reviewerId: reviews.reviewer_id,
          revieweeId: reviews.reviewee_id,
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.created_at,
        })
        .from(reviews)
        .where(eq(reviews.contract_id, contract.id));

      const clientReview = contractReviews.find(
        (r) => r.reviewerId === contract.client_id,
      );
      const freelancerReview = contractReviews.find(
        (r) => r.reviewerId === userId,
      );

      return {
        id: contract.id,
        title: contract.title,
        client: companyName || "Client",
        status: contract.status as "ACTIVE" | "COMPLETED",
        completed: contract.status === "COMPLETED" ? contract.updated_at : null,
        created_at: contract.created_at,
        amountCents: contract.total_amount_cents,
        rating: clientReview ? Number(clientReview.rating) : null,
        review: clientReview ? clientReview.comment : null,
        clientHasReviewed: Boolean(clientReview),
        freelancerHasReviewed: Boolean(freelancerReview),
        skills: skills ?? [],
      };
    }),
  );

  const revealedReviews = workHistory.filter(
    (item) =>
      item.status === "COMPLETED" &&
      item.clientHasReviewed &&
      item.freelancerHasReviewed &&
      item.rating !== null,
  );

  const revealedRatingSum = revealedReviews.reduce(
    (sum, item) => sum + (item.rating ?? 0),
    0,
  );

  const revealedRatingAverage =
    revealedReviews.length > 0
      ? Number((revealedRatingSum / revealedReviews.length).toFixed(1))
      : null;

  const totalJssPoints = revealedReviews.reduce(
    (sum, item) => sum + getJSSContribution(item.rating ?? 0),
    0,
  );

  const calculatedJssScore =
    revealedReviews.length > 0
      ? Number((totalJssPoints / revealedReviews.length).toFixed(2))
      : 0;

  const agency = await getAgencyIdentityForMember(userId);

  return {
    ...profile,
    identityVerified: result.accounts.identityVerified === true,
    joined_at: profile.created_at,
    portfolios,
    agency,
    stats: {
      totalEarningCents: earningStats?.totalEarningCents ?? 0,
      completedJobs: Number(
        earningStats?.completedJobs ??
          workHistory.filter((j) => j.status === "COMPLETED").length,
      ),
      ongoingJobs: Number(
        earningStats?.ongoingJobs ??
          workHistory.filter((j) => j.status === "ACTIVE").length,
      ),
      reviewCount: revealedReviews.length,
      jobSuccessScore: calculatedJssScore,
      rating: revealedRatingAverage,
    },
    workHistory,
  };
};

const MONTHLY_EARNINGS_SPAN = 7;

export const getFreelancerMonthlyEarnings = async (userId: string) => {
  const [earningsCheck] = await db
    .select({ hasEarnings: sql<boolean>`count(*) > 0` })
    .from(earning_history)
    .where(eq(earning_history.freelancer_id, userId));
  const hasEarnings = earningsCheck?.hasEarnings ?? false;

  if (!hasEarnings) {
    return {
      hasEarnings: false,
      currentMonthTotalCents: 0,
      previousMonthTotalCents: 0,
      series: [] as Array<{ month: string; totalCents: number }>,
    };
  }

  const spanStart = new Date();
  spanStart.setUTCDate(1);
  spanStart.setUTCHours(0, 0, 0, 0);
  spanStart.setUTCMonth(spanStart.getUTCMonth() - (MONTHLY_EARNINGS_SPAN - 1));

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${earning_history.created_at}), 'YYYY-MM')`,
      totalCents: sql<string>`sum(${earning_history.amount_cents} - ${earning_history.platform_fee_cents})`,
    })
    .from(earning_history)
    .where(
      and(
        eq(earning_history.freelancer_id, userId),
        gte(earning_history.created_at, spanStart),
      ),
    )
    .groupBy(sql`date_trunc('month', ${earning_history.created_at})`)
    .orderBy(sql`date_trunc('month', ${earning_history.created_at})`);

  const totalsByMonth = new Map(
    rows.map((row) => [row.month, toSafeCents(row.totalCents)]),
  );

  const series = Array.from({ length: MONTHLY_EARNINGS_SPAN }, (_, index) => {
    const date = new Date(spanStart);
    date.setUTCMonth(date.getUTCMonth() + index);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { month: key, totalCents: totalsByMonth.get(key) ?? 0 };
  });

  return {
    hasEarnings: true,
    currentMonthTotalCents: series.at(-1)?.totalCents ?? 0,
    previousMonthTotalCents: series.at(-2)?.totalCents ?? 0,
    series,
  };
};

const RECENT_EARNINGS_LIMIT = 20;

export const getFreelancerEarningsOverview = async (userId: string) => {
  const rows = await db
    .select({
      id: earning_history.id,
      amountCents: earning_history.amount_cents,
      platformFeeCents: earning_history.platform_fee_cents,
      createdAt: earning_history.created_at,
      contractTitle: contracts.title,
      clientCompany: client_metadata.company_name,
      paidOut: sql<boolean>`${payout_history.id} is not null`,
    })
    .from(earning_history)
    .innerJoin(contracts, eq(earning_history.contract_id, contracts.id))
    .leftJoin(client_metadata, eq(contracts.client_id, client_metadata.auth_id))
    .leftJoin(
      payout_history,
      and(
        eq(payout_history.earning_history_id, earning_history.id),
        eq(payout_history.status, "PAID"),
      ),
    )
    .where(eq(earning_history.freelancer_id, userId))
    .orderBy(desc(earning_history.created_at));

  const now = Date.now();
  let availableCents = 0;
  let pendingCents = 0;
  let withdrawnCents = 0;
  let totalFeesCents = 0;

  const earnings = rows.map((row) => {
    const grossAmountCents = row.amountCents;
    const platformFeeCents = row.platformFeeCents;
    const amountCents = grossAmountCents - platformFeeCents;
    const availableAt = new Date(
      row.createdAt.getTime() + EARNINGS_HOLD_PERIOD_MS,
    );
    const isAvailable = now >= availableAt.getTime();
    totalFeesCents += platformFeeCents;

    // A row already transferred to Stripe (payout_history) is neither
    // available nor pending anymore — the money has already left the
    // platform, so it must not be double-counted as still withdrawable.
    let status: "AVAILABLE" | "PENDING" | "WITHDRAWN";
    if (row.paidOut) {
      withdrawnCents += amountCents;
      status = "WITHDRAWN";
    } else if (isAvailable) {
      availableCents += amountCents;
      status = "AVAILABLE";
    } else {
      pendingCents += amountCents;
      status = "PENDING";
    }

    return {
      id: row.id,
      title: row.contractTitle,
      client: row.clientCompany ?? "Client",
      grossAmountCents,
      platformFeeCents,
      amountCents,
      date: row.createdAt,
      availableAt,
      status,
    };
  });

  return {
    availableCents,
    pendingCents,
    withdrawnCents,
    lifetimeCents: availableCents + pendingCents + withdrawnCents,
    totalFeesCents,
    feeRatePercent: PLATFORM_FEE_BPS / 100,
    recentEarnings: earnings.slice(0, RECENT_EARNINGS_LIMIT),
  };
};

export type EarningsCertificateWindow = {
  label: string;
  totalCents: number;
};

export type EarningsCertificateData = {
  freelancerName: string;
  professionalTitle: string;
  profileUrl: string;
  location: string;
  activeSince: Date;
  issuedAt: Date;
  windows: EarningsCertificateWindow[];
};

const ROLLING_WINDOW_DAYS = [30, 90, 180, 365] as const;
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const getFreelancerEarningsCertificateData = async (
  userId: string,
): Promise<EarningsCertificateData> => {
  if (!env.clerkSecretKey) {
    throw new ApiError(503, "Earnings certificates are not configured.");
  }

  const [account] = await db
    .select({
      professionalTitle: freelancer_metadata.professional_title,
      country: freelancer_metadata.country,
      city: freelancer_metadata.city,
      activeSince: freelancer_metadata.created_at,
      profileId: freelancer_metadata.id,
    })
    .from(accounts)
    .innerJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, accounts.auth_id),
    )
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "FREELANCER")))
    .limit(1);

  if (!account) throw new ApiError(404, "Freelancer profile not found.");

  const user = await clerk.users.getUser(userId);
  const freelancerName = user.fullName ?? "Freelancer";

  const rows = await db
    .select({
      amountCents: earning_history.amount_cents,
      platformFeeCents: earning_history.platform_fee_cents,
      createdAt: earning_history.created_at,
    })
    .from(earning_history)
    .where(eq(earning_history.freelancer_id, userId));

  const now = new Date();

  const windows = ROLLING_WINDOW_DAYS.map((days) => {
    const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const totalCents = rows.reduce((sum, row) => {
      if (row.createdAt < sinceDate) return sum;
      return sum + (row.amountCents - row.platformFeeCents);
    }, 0);
    return {
      label: `Last ${days} days`,
      totalCents,
    };
  });

  const countryName = account.country
    ? (regionNames.of(account.country) ?? account.country)
    : null;

  return {
    freelancerName,
    professionalTitle: account.professionalTitle,
    profileUrl: `https://www.onemarketplace.io/talent/${account.profileId}`,
    location:
      [account.city, countryName].filter(Boolean).join(", ") || "Not specified",
    activeSince: account.activeSince ?? now,
    issuedAt: now,
    windows,
  };
};

type StripeRequirementsLike =
  | {
      entries?: Array<{
        awaiting_action_from: string;
        minimum_deadline: { status: string };
      }>;
    }
  | undefined;

const hasBlockingRequirements = (requirements: StripeRequirementsLike) =>
  (requirements?.entries ?? []).some(
    (entry) =>
      entry.awaiting_action_from === "user" &&
      entry.minimum_deadline.status !== "eventually_due",
  );

export const getFreelancerPayoutManagementUrl = async (userId: string) => {
  if (!env.stripeSecretKey || !env.freelancerDashboard) {
    throw new ApiError(503, "Payouts are not configured.");
  }

  const [account] = await db
    .select({
      email: accounts.email,
      stripeConnectAccountId: accounts.stripe_connect_account_id,
      country: freelancer_metadata.country,
    })
    .from(accounts)
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, accounts.auth_id),
    )
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, "FREELANCER")))
    .limit(1);

  if (!account) throw new ApiError(404, "Freelancer account not found.");

  let connectAccountId = account.stripeConnectAccountId;
  let hasPendingRequirements: boolean;

  if (!connectAccountId) {
    // Use the freelancer's real country when Stripe Connect's cross-border
    // transfers support it; otherwise fall back to "us" so the account can
    // still be created and paid (e.g. via a US bank account the freelancer
    // adds themselves) instead of being permanently blocked. The account's
    // country can never be changed after creation.
    const realCountry = account.country?.toUpperCase();
    const connectCountry =
      realCountry && STRIPE_PAYOUT_ELIGIBLE_COUNTRIES.has(realCountry)
        ? realCountry.toLowerCase()
        : "us";

    const connectAccount = await stripe.v2.core.accounts.create({
      contact_email: account.email,
      dashboard: "express",
      identity: { country: connectCountry },
      configuration: {
        // Stripe requires merchant.card_payments to be requested alongside
        // recipient.stripe_balance.stripe_transfers — even though this
        // platform never routes card payments through the freelancer's own
        // merchant capability (clients pay via the platform's own Checkout;
        // funds move to freelancers only via internal transfers).
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
      },
      defaults: {
        responsibilities: {
          fees_collector: "application_express",
          losses_collector: "application",
        },
      },
      include: ["requirements"],
    });

    connectAccountId = connectAccount.id;
    hasPendingRequirements = hasBlockingRequirements(
      connectAccount.requirements,
    );

    await db
      .update(accounts)
      .set({
        stripe_connect_account_id: connectAccountId,
        updated_at: new Date(),
      })
      .where(eq(accounts.auth_id, userId));
  } else {
    const existingAccount = await stripe.v2.core.accounts.retrieve(
      connectAccountId,
      { include: ["requirements"] },
    );
    hasPendingRequirements = hasBlockingRequirements(
      existingAccount.requirements,
    );
  }

  const returnUrl = `${env.freelancerDashboard}/settings?section=withdrawal`;

  if (hasPendingRequirements) {
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: connectAccountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: returnUrl,
          return_url: returnUrl,
        },
      },
    });
    return accountLink.url;
  }

  const loginLink = await stripe.accounts.createLoginLink(connectAccountId);
  return loginLink.url;
};

const uploadPortfolioImages = async (
  userId: string,
  portfolios: PortfolioData[],
) => {
  if (!env.imageKitPrivateKey) {
    throw new ApiError(503, "Portfolio image uploads are not configured.");
  }

  const uploadedFileIds: string[] = [];
  const uploadedPortfolios: PortfolioData[] = [];

  try {
    for (const portfolio of portfolios) {
      if (!isImageDataUrl(portfolio.cover_image.url)) {
        uploadedPortfolios.push(portfolio);
        continue;
      }

      const upload = await imageKit.files.upload({
        file: portfolio.cover_image.url,
        fileName: `portfolio-${randomUUID()}`,
        folder: `/onemarketplace/freelancer-portfolios/${userId}`,
      });

      if (!upload.fileId || !upload.url) {
        throw new ApiError(502, "Portfolio image upload failed.");
      }

      uploadedFileIds.push(upload.fileId);
      uploadedPortfolios.push({
        ...portfolio,
        cover_image: { imageId: upload.fileId, url: upload.url },
      });
    }

    return { uploadedPortfolios, uploadedFileIds };
  } catch (error) {
    await Promise.allSettled(
      uploadedFileIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const saveFreelancerProfile = async (
  input: SaveFreelancerProfileInput,
  isOnboarded: boolean | undefined,
): Promise<FreelancerProfileData> => {
  const existingImages = await db
    .select({ cover_image: freelancer_portfolios.cover_image })
    .from(freelancer_portfolios)
    .innerJoin(
      freelancer_metadata,
      eq(freelancer_portfolios.freelancer_id, freelancer_metadata.id),
    )
    .where(eq(freelancer_metadata.auth_id, input.userId));

  const storedImages = existingImages.map(({ cover_image }) => cover_image);
  const resolvedPortfolios: PortfolioData[] = input.portfolios.map(
    (portfolio) => ({
      ...portfolio,
      cover_image: isImageDataUrl(portfolio.cover_image.url)
        ? { imageId: "", url: portfolio.cover_image.url }
        : reuseStoredImage(storedImages, portfolio.cover_image.url),
    }),
  );

  const { uploadedPortfolios, uploadedFileIds } = await uploadPortfolioImages(
    input.userId,
    resolvedPortfolios,
  );

  let profile: FreelancerProfileData;

  try {
    profile = await db.transaction(async (transaction) => {
      const [account] = await transaction
        .update(accounts)
        .set({ isOnboardingComplete: true })
        .where(
          and(
            eq(accounts.auth_id, input.userId),
            eq(accounts.role, "FREELANCER"),
          ),
        )
        .returning();

      if (!account) throw new ApiError(404, "Freelancer account not found.");

      let country = input.country;
      let city = input.city;

      if (account.identityVerified) {
        const [existingMetadata] = await transaction
          .select({
            country: freelancer_metadata.country,
            city: freelancer_metadata.city,
          })
          .from(freelancer_metadata)
          .where(eq(freelancer_metadata.auth_id, input.userId));

        if (existingMetadata) {
          country = existingMetadata.country;
          city = existingMetadata.city;
        }
      }

      const metadataValues = {
        professional_title: input.professional_title,
        professional_description: input.professional_description,
        hourly_rate_cents: input.hourly_rate_cents,
        country,
        city,
        availability_status: input.availability_status,
        weekly_availability: input.weekly_availability,
        experience_level: input.experience_level,
        skills: input.skills,
        languages: input.languages,
      };

      const [metadata] = await transaction
        .insert(freelancer_metadata)
        .values({
          auth_id: input.userId,
          ...metadataValues,
        })
        .onConflictDoUpdate({
          target: freelancer_metadata.auth_id,
          set: metadataValues,
        })
        .returning();

      if (!metadata) {
        throw new ApiError(500, "Freelancer profile could not be saved.");
      }

      await transaction
        .delete(freelancer_portfolios)
        .where(eq(freelancer_portfolios.freelancer_id, metadata.id));

      const portfolios = await transaction
        .insert(freelancer_portfolios)
        .values(
          uploadedPortfolios.map((portfolio) => ({
            freelancer_id: metadata.id,
            ...portfolio,
          })),
        )
        .returning();

      return {
        professional_title: metadata.professional_title,
        professional_description: metadata.professional_description,
        hourly_rate_cents: metadata.hourly_rate_cents,
        country: metadata.country,
        city: metadata.city,
        availability_status: metadata.availability_status,
        weekly_availability: metadata.weekly_availability,
        experience_level: metadata.experience_level,
        skills: metadata.skills,
        languages: metadata.languages,
        portfolios,
        identityVerified: account.identityVerified === true,
        joined_at: metadata.created_at,
      };
    });
  } catch (error) {
    await Promise.allSettled(
      uploadedFileIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }

  await invalidateAccountAuthCache(input.userId);

  const retainedImageIds = new Set(
    uploadedPortfolios.map(({ cover_image }) => cover_image.imageId),
  );

  await Promise.allSettled(
    existingImages
      .map(({ cover_image }) => cover_image.imageId)
      .filter((fileId) => fileId && !retainedImageIds.has(fileId))
      .map((fileId) => imageKit.files.delete(fileId)),
  );

  try {
    if (!isOnboarded) {
      await addConnects(input.userId);
    }
  } catch (error) {
    await logger.error({
      message: "Onboarding connects could not be added",
      eventName: "connects.onboarding.failed",
      attributes: {
        "account.type": "freelancer",
        "error.name": error instanceof Error ? error.name : "UnknownError",
        ...errorLogAttributes(error),
      },
    });
  }

  return profile;
};

export interface JobFeedFilters {
  sort?: "best-match" | "recent";
  levels?: string[];
  durations?: string[];
  minBudgetCents?: number;
  maxBudgetCents?: number;
  minProposals?: number;
  maxProposals?: number;
  paymentVerified?: boolean;
}

// Strips spacing/punctuation so equivalent skill names entered through
// different UI conventions still match, e.g. "Next Js" (freelancer skill
// picker) vs "Next.js" (job post skill tag) — both normalize to "nextjs".
const normalizeSkill = (skill: string) =>
  skill.toLowerCase().replace(/[^a-z0-9]/g, "");

// Shared by both the freelancer and agency job feeds — "skills" is either a
// freelancer's own skills or an agency's tags, matched against each job's
// required skills and title/description text the same way either side.
export const getMatchedJobPostsBySkills = async (
  skillList: string[],
  filters: JobFeedFilters = {},
) => {
  const skills = skillList.map(normalizeSkill);

  const jobs = await db
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(eq(job_posts.status, "PUBLISHED"))
    .orderBy(desc(job_posts.published_at));

  const proposalCounts = await db
    .select({ jobId: proposals.job_id, count: count(proposals.id) })
    .from(proposals)
    .groupBy(proposals.job_id);
  const hireCounts = await db
    .select({ jobId: contracts.job_id, count: count(contracts.id) })
    .from(contracts)
    .where(inArray(contracts.status, ["ACTIVE", "COMPLETED"]))
    .groupBy(contracts.job_id);

  const clientCountries = new Map(
    await Promise.all(
      [...new Set(jobs.map(({ job }) => job.client_id))].map(
        async (clientId) =>
          [clientId, await getClientCountry(clientId)] as const,
      ),
    ),
  );

  const counts = new Map(
    proposalCounts?.map((item) => [item.jobId, Number(item.count)]),
  );
  const hires = new Map(
    hireCounts.map((item) => [item.jobId, Number(item.count)]),
  );

  const filteredJobs = jobs
    .map(
      ({
        job,
        companyName,
        paymentVerified,
        totalSpentCents,
        clientRating,
        clientReviewCount,
      }) => ({
        ...job,
        companyName,
        clientCountry: clientCountries.get(job.client_id) ?? null,
        paymentVerified: paymentVerified === true,
        proposalCount: counts?.get(job.id) ?? 0,
        hireCount: hires.get(job.id) ?? 0,
        clientTotalSpentCents: totalSpentCents ?? 0,
        clientRating: Number(clientRating ?? 0),
        clientReviewCount: Number(clientReviewCount ?? 0),
      }),
    )
    .filter((job) => {
      const budgetCents = job.total_budget_cents;
      return (
        (!filters.levels?.length ||
          filters.levels.includes(job.expertise_level)) &&
        (!filters.durations?.length ||
          filters.durations.includes(job.expected_duration)) &&
        (filters.minBudgetCents === undefined ||
          budgetCents >= filters.minBudgetCents) &&
        (filters.maxBudgetCents === undefined ||
          budgetCents <= filters.maxBudgetCents) &&
        (filters.minProposals === undefined ||
          job.proposalCount >= filters.minProposals) &&
        (filters.maxProposals === undefined ||
          job.proposalCount <= filters.maxProposals) &&
        (!filters.paymentVerified || job.paymentVerified)
      );
    });

  if (filters.sort === "recent") return filteredJobs;

  return filteredJobs
    .map((job) => {
      const jobSkills = job.skills.map(normalizeSkill);
      const content = normalizeSkill(`${job.title} ${job.description}`);
      const skillMatches = skills.filter((skill) =>
        jobSkills.some(
          (jobSkill) => jobSkill === skill || jobSkill.includes(skill),
        ),
      ).length;
      const contentMatches = skills.filter((skill) =>
        content.includes(skill),
      ).length;

      return { ...job, matchScore: skillMatches * 2 + contentMatches };
    })
    .filter((job) => job.matchScore > 0)
    .sort(
      (first, second) =>
        second.matchScore - first.matchScore ||
        new Date(second.published_at ?? second.created_at ?? 0).getTime() -
          new Date(first.published_at ?? first?.created_at ?? 0).getTime(),
    );
};

export const getMatchedJobPosts = async (
  userId: string,
  filters: JobFeedFilters = {},
) => {
  const [profile] = await db
    .select({ skills: freelancer_metadata.skills })
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.auth_id, userId));

  if (!profile) throw new ApiError(404, "Freelancer profile not found.");

  return getMatchedJobPostsBySkills(profile.skills, filters);
};

export const getFreelancerJobPost = async (jobId: string) => {
  const [result] = await db
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      companyDescription: client_metadata.company_description,
      paymentVerified: accounts.paymentMethodVerified,
      clientJoinedAt: accounts.created_at,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);

  if (!result) throw new ApiError(404, "Job post not found.");

  const [proposalTotal] = await db
    .select({ count: count(proposals.id) })
    .from(proposals)
    .where(eq(proposals.job_id, jobId));
  const [hireTotal] = await db
    .select({ count: count(contracts.id) })
    .from(contracts)
    .where(
      and(
        eq(contracts.job_id, jobId),
        inArray(contracts.status, ["ACTIVE", "COMPLETED"]),
      ),
    );

  const clientCountry = await getClientCountry(result.job.client_id);

  return {
    ...result.job,
    companyName: result.companyName,
    companyDescription: result.companyDescription,
    clientCountry,
    paymentVerified: result.paymentVerified === true,
    clientJoinedAt: result.clientJoinedAt,
    proposalCount: Number(proposalTotal?.count ?? 0),
    hireCount: Number(hireTotal?.count ?? 0),
    clientTotalSpentCents: result.totalSpentCents ?? 0,
    clientRating: Number(result.clientRating ?? 0),
    clientReviewCount: Number(result.clientReviewCount ?? 0),
  };
};

export const getPublicFreelancerProfile = async (profileId: string) => {
  const [freelancer] = await db
    .select({ userId: freelancer_metadata.auth_id })
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.id, profileId))
    .limit(1);
  if (!freelancer) return null;

  const profile = await getFreelancerProfile(freelancer.userId);
  if (!profile) return null;

  let user;
  try {
    user = await clerk.users.getUser(freelancer.userId);
  } catch {
    return null;
  }
  const { auth_id: _authId, ...publicProfile } =
    profile as FreelancerProfileData & {
      auth_id?: string;
    };

  return {
    ...publicProfile,
    id: profileId,
    name: user.fullName ?? "Freelancer",
    avatarUrl: user.imageUrl || null,
  };
};

export interface PublicTalentSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  title: string;
  location: string;
  verified: boolean;
  active: boolean;
  jobSuccess: number;
  completedProjects: number;
  rating: number;
  reviews: number;
  hourlyRateCents: number;
  skills: string[];
  summary: string;
}

export interface PublicTalentSearchFilters {
  query?: string;
  verifiedOnly?: boolean;
  availableOnly?: boolean;
  minRating?: number;
  minSuccess?: number;
  minRateCents?: number;
  maxRateCents?: number;
  sort?: "recommended" | "rating" | "success" | "projects" | "rate-low";
}

export interface PublicTalentSearchPage {
  results: PublicTalentSummary[];
  hasMore: boolean;
}

const PUBLIC_TALENT_PAGE_SIZE = 20;
const publicTalentRegionNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

export const searchPublicFreelancers = async (
  filters: PublicTalentSearchFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicTalentSearchPage> => {
  const limit = pagination.limit ?? PUBLIC_TALENT_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const conditions = [];
  if (filters.verifiedOnly)
    conditions.push(eq(accounts.identityVerified, true));
  if (filters.availableOnly) {
    conditions.push(eq(freelancer_metadata.availability_status, "AVAILABLE"));
  }
  if (filters.minRating) {
    conditions.push(gte(freelancer_earning.rating, String(filters.minRating)));
  }
  if (filters.minSuccess) {
    conditions.push(
      gte(freelancer_earning.job_success_score, String(filters.minSuccess)),
    );
  }
  if (filters.minRateCents) {
    conditions.push(
      gte(freelancer_metadata.hourly_rate_cents, filters.minRateCents),
    );
  }
  if (filters.maxRateCents) {
    conditions.push(
      lte(freelancer_metadata.hourly_rate_cents, filters.maxRateCents),
    );
  }

  const orderBy = (() => {
    switch (filters.sort) {
      case "rating":
        return desc(freelancer_earning.rating);
      case "success":
        return desc(freelancer_earning.job_success_score);
      case "projects":
        return desc(freelancer_earning.completed_jobs);
      case "rate-low":
        return asc(freelancer_metadata.hourly_rate_cents);
      default:
        return desc(
          sql`${freelancer_earning.rating} * ${freelancer_earning.job_success_score}`,
        );
    }
  })();

  const rows = await db
    .select({
      id: freelancer_metadata.id,
      authId: freelancer_metadata.auth_id,
      professionalTitle: freelancer_metadata.professional_title,
      professionalDescription: freelancer_metadata.professional_description,
      hourlyRateCents: freelancer_metadata.hourly_rate_cents,
      city: freelancer_metadata.city,
      country: freelancer_metadata.country,
      skills: freelancer_metadata.skills,
      availabilityStatus: freelancer_metadata.availability_status,
      identityVerified: accounts.identityVerified,
      rating: freelancer_earning.rating,
      jobSuccessScore: freelancer_earning.job_success_score,
      completedJobs: freelancer_earning.completed_jobs,
      reviewCount: freelancer_earning.review_count,
    })
    .from(freelancer_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, freelancer_metadata.auth_id))
    .leftJoin(
      freelancer_earning,
      eq(freelancer_earning.freelancer_id, freelancer_metadata.auth_id),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const hasMore = rows.length === limit;
  if (!rows.length || !env.clerkSecretKey)
    return { results: [], hasMore: false };

  const clerkUsers = await Promise.all(
    rows.map(async (row) => {
      try {
        return await clerk.users.getUser(row.authId);
      } catch {
        return null;
      }
    }),
  );

  const results: PublicTalentSummary[] = [];
  rows.forEach((row, index) => {
    const user = clerkUsers[index];
    const name = user?.fullName ?? "Freelancer";
    const countryName = row.country
      ? (publicTalentRegionNames.of(row.country) ?? row.country)
      : null;
    const location =
      [row.city, countryName].filter(Boolean).join(", ") ||
      "Location unavailable";
    const searchable = [name, row.professionalTitle, location, ...row.skills]
      .join(" ")
      .toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return;

    results.push({
      id: row.id,
      name,
      avatarUrl: user?.imageUrl || null,
      title: row.professionalTitle || "Freelancer",
      location,
      verified: row.identityVerified === true,
      active: row.availabilityStatus === "AVAILABLE",
      jobSuccess: Math.round(Number(row.jobSuccessScore ?? 0)),
      completedProjects: Number(row.completedJobs ?? 0),
      rating: Number(row.rating ?? 0),
      reviews: Number(row.reviewCount ?? 0),
      hourlyRateCents: row.hourlyRateCents,
      skills: row.skills,
      summary: row.professionalDescription,
    });
  });

  return { results, hasMore };
};
