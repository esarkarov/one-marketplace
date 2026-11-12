import { randomUUID } from "crypto";
import { clerk } from "../../infrastructure/clerk.js";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import {
  accounts,
  agency_earning,
  agency_invitations,
  agency_members,
  agency_metadata,
  agency_portfolios,
  client_metadata,
  contracts,
  earning_history,
  freelancer_earning,
  freelancer_metadata,
  payout_history,
  reviews,
} from "../../database/schema.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { DbExecutor } from "../../database/db-executor.js";
import { imageKit } from "../../infrastructure/image-kit.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/utils/sanitize-log.js";
import { stripe } from "../../infrastructure/stripe.js";
import { addAgencyConnects } from "../connects/connects.public.js";
import {
  isAgencyRoleAllowed,
  type AgencyPermission,
} from "./agency.permissions.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";
import {
  EARNINGS_HOLD_PERIOD_MS,
  INITIAL_CONNECTS,
  STRIPE_PAYOUT_ELIGIBLE_COUNTRIES,
} from "../../config/constants.js";
import { getJSSContribution } from "../freelancer/freelancer.public.js";
import {
  isImageDataUrl,
  reuseStoredImage,
  type StoredImage,
} from "../../shared/utils/portfolio-images.js";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export interface AgencyPortfolioItem {
  id: string;
  title: string;
  category: string;
  description: string;
  liveUrl: string | null;
  coverImage: StoredImage;
}

export interface AgencyMember {
  id: string;
  freelancerId: string;
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string;
  skills: string[];
  isOwner: boolean;
  rating: number;
  jobSuccessScore: number;
  completedProjects: number;
}

export interface AgencyWorkHistoryItem {
  id: string;
  title: string;
  client: string;
  status: "ACTIVE" | "COMPLETED";
  completed: Date | null;
  amountCents: number;
  rating: number | null;
  review: string | null;
  clientHasReviewed: boolean;
  freelancerHasReviewed: boolean;
}

export interface AgencyStats {
  totalEarningCents: number;
  completedJobs: number;
  ongoingJobs: number;
  reviewCount: number;
  jobSuccessScore: number;
  rating: number | null;
}

export interface AgencyData {
  id: string;
  name: string;
  professionalTitle: string | null;
  size: string;
  specialty: string;
  website: string | null;
  overview: string;
  tags: string[];
  avatarImage: StoredImage | null;
  isOnboarded: boolean;
  portfolio: AgencyPortfolioItem[];
  ownerLocation: string | null;
  ownerLanguages: string[];
  ownerLanguageDetails: Array<{ language: string; proficiency: string }>;
  members: AgencyMember[];
  createdAt: Date | null;
  stats: AgencyStats;
  workHistory: AgencyWorkHistoryItem[];
}

export interface CreateAgencyInput {
  ownerId: string;
  name: string;
  size: string;
  specialty: string;
  website?: string;
  overview: string;
}

export interface ImageInput {
  url: string;
}

export interface UpdateAgencyPortfolioInput {
  title: string;
  category: string;
  description: string;
  liveUrl?: string;
  coverImage: ImageInput;
}

export interface UpdateAgencyInput {
  ownerId: string;
  name: string;
  professionalTitle: string;
  size: string;
  specialty: string;
  website?: string;
  overview: string;
  tags: string[];
  avatarImage?: ImageInput;
  portfolio: UpdateAgencyPortfolioInput[];
}

const agencyColumns = {
  id: agency_metadata.id,
  name: agency_metadata.name,
  professionalTitle: agency_metadata.professional_title,
  size: agency_metadata.size,
  specialty: agency_metadata.specialty,
  website: agency_metadata.website,
  overview: agency_metadata.overview,
  tags: agency_metadata.tags,
  avatarImage: agency_metadata.avatar_image,
  isOnboarded: agency_metadata.is_onboarded,
  createdAt: agency_metadata.created_at,
};

const getAgencyPortfolio = async (
  agencyId: string,
): Promise<AgencyPortfolioItem[]> =>
  db
    .select({
      id: agency_portfolios.id,
      title: agency_portfolios.title,
      category: agency_portfolios.category,
      description: agency_portfolios.description,
      liveUrl: agency_portfolios.live_url,
      coverImage: agency_portfolios.cover_image,
    })
    .from(agency_portfolios)
    .where(eq(agency_portfolios.agency_id, agencyId));

const getAgencyWorkHistoryAndStats = async (
  agencyId: string,
): Promise<{ stats: AgencyStats; workHistory: AgencyWorkHistoryItem[] }> => {
  const [earningStats] = await db
    .select({
      totalEarningCents: agency_earning.total_earning_cents,
      completedJobs: agency_earning.completed_jobs,
      ongoingJobs: agency_earning.ongoing_jobs,
    })
    .from(agency_earning)
    .where(eq(agency_earning.agency_id, agencyId))
    .limit(1);

  const agencyContracts = await db
    .select({
      contract: contracts,
      companyName: client_metadata.company_name,
    })
    .from(contracts)
    .innerJoin(
      client_metadata,
      eq(contracts.client_id, client_metadata.auth_id),
    )
    .where(
      and(
        eq(contracts.agency_id, agencyId),
        inArray(contracts.status, ["ACTIVE", "COMPLETED"]),
      ),
    )
    .orderBy(desc(contracts.updated_at));

  const workHistory: AgencyWorkHistoryItem[] = await Promise.all(
    agencyContracts.map(async ({ contract, companyName }) => {
      const contractReviews = await db
        .select({
          reviewerId: reviews.reviewer_id,
          rating: reviews.rating,
          comment: reviews.comment,
        })
        .from(reviews)
        .where(eq(reviews.contract_id, contract.id));

      const clientReview = contractReviews.find(
        (review) => review.reviewerId === contract.client_id,
      );
      const agencyReview = contractReviews.find(
        (review) => review.reviewerId !== contract.client_id,
      );

      return {
        id: contract.id,
        title: contract.title,
        client: companyName || "Client",
        status: contract.status as "ACTIVE" | "COMPLETED",
        completed: contract.status === "COMPLETED" ? contract.updated_at : null,
        amountCents: contract.total_amount_cents,
        rating: clientReview ? Number(clientReview.rating) : null,
        review: clientReview ? clientReview.comment : null,
        clientHasReviewed: Boolean(clientReview),
        freelancerHasReviewed: Boolean(agencyReview),
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

  const revealedRatingAverage =
    revealedReviews.length > 0
      ? Number(
          (
            revealedReviews.reduce((sum, item) => sum + (item.rating ?? 0), 0) /
            revealedReviews.length
          ).toFixed(1),
        )
      : null;

  const totalJssPoints = revealedReviews.reduce(
    (sum, item) => sum + getJSSContribution(item.rating ?? 0),
    0,
  );
  const calculatedJssScore =
    revealedReviews.length > 0
      ? Number((totalJssPoints / revealedReviews.length).toFixed(2))
      : 0;

  return {
    stats: {
      totalEarningCents: earningStats?.totalEarningCents ?? 0,
      completedJobs: Number(
        earningStats?.completedJobs ??
          workHistory.filter((item) => item.status === "COMPLETED").length,
      ),
      ongoingJobs: Number(
        earningStats?.ongoingJobs ??
          workHistory.filter((item) => item.status === "ACTIVE").length,
      ),
      reviewCount: revealedReviews.length,
      jobSuccessScore: calculatedJssScore,
      rating: revealedRatingAverage,
    },
    workHistory,
  };
};

const MONTHLY_EARNINGS_SPAN = 7;

export const getAgencyMonthlyEarnings = async (agencyId: string) => {
  const [earningsCheck] = await db
    .select({ hasEarnings: sql<boolean>`count(*) > 0` })
    .from(earning_history)
    .where(eq(earning_history.agency_id, agencyId));
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
        eq(earning_history.agency_id, agencyId),
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

const RECENT_AGENCY_EARNINGS_LIMIT = 20;

export const getAgencyEarningsOverview = async (agencyId: string) => {
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
    .where(eq(earning_history.agency_id, agencyId))
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
    recentEarnings: earnings.slice(0, RECENT_AGENCY_EARNINGS_LIMIT),
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

const hasBlockingAgencyRequirements = (requirements: StripeRequirementsLike) =>
  (requirements?.entries ?? []).some(
    (entry) =>
      entry.awaiting_action_from === "user" &&
      entry.minimum_deadline.status !== "eventually_due",
  );

export const getAgencyPayoutManagementUrl = async (agencyId: string) => {
  if (!env.stripeSecretKey || !env.agencyDashboard) {
    throw new ApiError(503, "Payouts are not configured.");
  }

  const [agency] = await db
    .select({
      name: agency_metadata.name,
      ownerId: agency_metadata.owner_id,
      stripeConnectAccountId: agency_metadata.stripe_connect_account_id,
      ownerEmail: accounts.email,
      ownerCountry: freelancer_metadata.country,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, agency_metadata.owner_id),
    )
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);

  if (!agency) throw new ApiError(404, "Agency workspace not found.");

  let connectAccountId = agency.stripeConnectAccountId;
  let hasPendingRequirements: boolean;

  if (!connectAccountId) {
    // The agency has no country of its own on file — bootstrap the Connect
    // account with the owner's real country as the best available signal,
    // same fallback-to-"us" rule as freelancer accounts. The payout
    // destination is still the agency's own account, not the owner's.
    const realCountry = agency.ownerCountry?.toUpperCase();
    const connectCountry =
      realCountry && STRIPE_PAYOUT_ELIGIBLE_COUNTRIES.has(realCountry)
        ? realCountry.toLowerCase()
        : "us";

    const connectAccount = await stripe.v2.core.accounts.create({
      contact_email: agency.ownerEmail,
      dashboard: "express",
      identity: { country: connectCountry },
      configuration: {
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
    hasPendingRequirements = hasBlockingAgencyRequirements(
      connectAccount.requirements,
    );

    await db
      .update(agency_metadata)
      .set({
        stripe_connect_account_id: connectAccountId,
        updated_at: new Date(),
      })
      .where(eq(agency_metadata.id, agencyId));
  } else {
    const existingAccount = await stripe.v2.core.accounts.retrieve(
      connectAccountId,
      { include: ["requirements"] },
    );
    hasPendingRequirements = hasBlockingAgencyRequirements(
      existingAccount.requirements,
    );
  }

  const returnUrl = `${env.agencyDashboard}/finances?section=withdrawals`;

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

const attachOwnerProfile = async (
  ownerId: string,
  agency: Omit<
    AgencyData,
    | "ownerLocation"
    | "ownerLanguages"
    | "ownerLanguageDetails"
    | "members"
    | "stats"
    | "workHistory"
  >,
): Promise<AgencyData> => {
  const memberRows = await db
    .select({
      id: agency_members.id,
      freelancerId: agency_members.freelancer_id,
      profileId: freelancer_metadata.id,
      role: agency_members.role,
      professionalTitle: freelancer_metadata.professional_title,
      country: freelancer_metadata.country,
      city: freelancer_metadata.city,
      languages: freelancer_metadata.languages,
      skills: freelancer_metadata.skills,
      rating: freelancer_earning.rating,
      jobSuccessScore: freelancer_earning.job_success_score,
      completedProjects: freelancer_earning.completed_jobs,
    })
    .from(agency_members)
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, agency_members.freelancer_id),
    )
    .leftJoin(
      freelancer_earning,
      eq(freelancer_earning.freelancer_id, agency_members.freelancer_id),
    )
    .where(eq(agency_members.agency_id, agency.id))
    .orderBy(agency_members.created_at);

  const ownerRow = memberRows.find((row) => row.freelancerId === ownerId);

  const ownerLocation = ownerRow?.country
    ? [ownerRow.city, regionNames.of(ownerRow.country) ?? ownerRow.country]
        .filter(Boolean)
        .join(", ") || null
    : null;
  const ownerLanguages =
    ownerRow?.languages?.map((entry) => entry.language) ?? [];
  const ownerLanguageDetails = ownerRow?.languages ?? [];

  const freelancerIds = memberRows.map((row) => row.freelancerId);
  const names = new Map<string, string>();
  const avatars = new Map<string, string | null>();

  if (env.clerkSecretKey) {
    await Promise.all(
      freelancerIds.map(async (freelancerId) => {
        try {
          const user = await clerk.users.getUser(freelancerId);
          names.set(
            freelancerId,
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              "Marketplace user",
          );
          avatars.set(freelancerId, user.imageUrl || null);
        } catch {
          names.set(freelancerId, "Marketplace user");
          avatars.set(freelancerId, null);
        }
      }),
    );
  }

  const members: AgencyMember[] = memberRows.map((row) => {
    const isOwner = row.freelancerId === ownerId;
    return {
      id: row.id,
      freelancerId: row.freelancerId,
      profileId: row.profileId,
      name: names.get(row.freelancerId) ?? "Marketplace user",
      avatarUrl: avatars.get(row.freelancerId) ?? null,
      role: isOwner
        ? ["Founder", row.professionalTitle].filter(Boolean).join(" · ")
        : row.role,
      skills: row.skills ?? [],
      isOwner,
      rating: Number(row.rating ?? 0),
      jobSuccessScore: Number(row.jobSuccessScore ?? 0),
      completedProjects: row.completedProjects ?? 0,
    };
  });

  const { stats, workHistory } = await getAgencyWorkHistoryAndStats(agency.id);

  return {
    ...agency,
    ownerLocation,
    ownerLanguages,
    ownerLanguageDetails,
    members,
    stats,
    workHistory,
  };
};

export const getAgencyByOwner = async (
  ownerId: string,
): Promise<AgencyData | null> => {
  const [agency] = await db
    .select(agencyColumns)
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId))
    .limit(1);

  if (!agency) return null;

  const portfolio = await getAgencyPortfolio(agency.id);

  return attachOwnerProfile(ownerId, {
    ...agency,
    avatarImage: agency.avatarImage ?? null,
    portfolio,
  });
};

export const getPublicAgencyProfile = async (
  agencyId: string,
): Promise<AgencyData | null> => {
  const [agency] = await db
    .select({ ...agencyColumns, ownerId: agency_metadata.owner_id })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);

  if (!agency) return null;

  const { ownerId, ...agencyData } = agency;
  const portfolio = await getAgencyPortfolio(agency.id);

  return attachOwnerProfile(ownerId, {
    ...agencyData,
    avatarImage: agencyData.avatarImage ?? null,
    portfolio,
  });
};

export const getAgencyForMember = async (
  freelancerId: string,
): Promise<AgencyData | null> => {
  const agencyId = await getAgencyIdForMember(freelancerId);
  if (!agencyId) return null;
  return getPublicAgencyProfile(agencyId);
};

const AGENCY_MEMBER_UNIQUE = "agency_members_freelancer_id_unique";
const AGENCY_OWNER_UNIQUE = "agency_metadata_owner_id_unique";

const isUniqueViolation = (error: unknown, constraintName: string): boolean => {
  for (
    let current: unknown = error, depth = 0;
    typeof current === "object" && current !== null && depth < 3;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, constraint } = current as {
      code?: unknown;
      constraint?: unknown;
    };
    if (code === "23505" && constraint === constraintName) return true;
  }
  return false;
};

const alreadyInAgencyError = (message: string) =>
  new ApiError(409, message, "ALREADY_IN_AGENCY");

const ALREADY_IN_AGENCY_MESSAGE =
  "You're already part of an agency. Leave your current agency before joining a new one.";

const invitationHandledError = () =>
  new ApiError(
    409,
    "This invitation has already been handled.",
    "INVITATION_ALREADY_HANDLED",
  );

export const createAgency = async (
  input: CreateAgencyInput,
): Promise<AgencyData> => {
  const existing = await getAgencyByOwner(input.ownerId);
  if (existing) {
    throw alreadyInAgencyError("You already have an agency workspace.");
  }
  if (await getAgencyIdForMember(input.ownerId)) {
    throw alreadyInAgencyError(ALREADY_IN_AGENCY_MESSAGE);
  }

  const now = new Date();

  let created;
  try {
    created = await db.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(agency_metadata)
        .values({
          owner_id: input.ownerId,
          name: input.name,
          size: input.size,
          specialty: input.specialty,
          website: input.website || null,
          overview: input.overview,
          created_at: now,
          updated_at: now,
        })
        .returning(agencyColumns);

      if (!row) {
        throw new ApiError(500, "The agency could not be created.");
      }

      await transaction.insert(agency_members).values({
        agency_id: row.id,
        freelancer_id: input.ownerId,
        role: "Founder",
      });

      return row;
    });
  } catch (error) {
    if (
      isUniqueViolation(error, AGENCY_MEMBER_UNIQUE) ||
      isUniqueViolation(error, AGENCY_OWNER_UNIQUE)
    ) {
      throw alreadyInAgencyError(ALREADY_IN_AGENCY_MESSAGE);
    }
    throw error;
  }

  return attachOwnerProfile(input.ownerId, {
    ...created,
    avatarImage: created.avatarImage ?? null,
    portfolio: [],
  });
};

const resolveAgencyImages = async (
  ownerId: string,
  input: UpdateAgencyInput,
  stored: {
    avatarImage: StoredImage | null;
    coverImages: StoredImage[];
  },
) => {
  const uploadedFileIds: string[] = [];

  if (input.avatarImage && !isImageDataUrl(input.avatarImage.url)) {
    reuseStoredImage([stored.avatarImage], input.avatarImage.url);
  }
  for (const item of input.portfolio) {
    if (!isImageDataUrl(item.coverImage.url)) {
      reuseStoredImage(stored.coverImages, item.coverImage.url);
    }
  }

  const resolveOne = async (
    image: ImageInput,
    prefix: string,
    candidates: Array<StoredImage | null>,
  ): Promise<StoredImage> => {
    if (!isImageDataUrl(image.url)) {
      return reuseStoredImage(candidates, image.url);
    }

    if (!env.imageKitPrivateKey) {
      throw new ApiError(503, "Image uploads are not configured.");
    }

    const result = await imageKit.files.upload({
      file: image.url,
      fileName: `${prefix}-${randomUUID()}`,
      folder: `/onemarketplace/agency-portfolios/${ownerId}`,
    });

    if (!result.fileId || !result.url) {
      throw new ApiError(502, "Image upload failed.");
    }

    uploadedFileIds.push(result.fileId);
    return { imageId: result.fileId, url: result.url };
  };

  try {
    const avatarImage = input.avatarImage
      ? await resolveOne(input.avatarImage, "avatar", [stored.avatarImage])
      : undefined;

    const portfolio = await Promise.all(
      input.portfolio.map(async (item) => ({
        ...item,
        coverImage: await resolveOne(
          item.coverImage,
          "portfolio",
          stored.coverImages,
        ),
      })),
    );

    return { avatarImage, portfolio, uploadedFileIds };
  } catch (error) {
    await Promise.allSettled(
      uploadedFileIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const updateAgencyProfile = async (
  input: UpdateAgencyInput,
): Promise<AgencyData> => {
  const existing = await getAgencyByOwner(input.ownerId);
  if (!existing) {
    throw new ApiError(404, "No agency workspace was found for this account.");
  }

  const { avatarImage, portfolio, uploadedFileIds } = await resolveAgencyImages(
    input.ownerId,
    input,
    {
      avatarImage: existing.avatarImage ?? null,
      coverImages: existing.portfolio.map((item) => item.coverImage),
    },
  );

  let result: Omit<
    AgencyData,
    | "ownerLocation"
    | "ownerLanguages"
    | "ownerLanguageDetails"
    | "members"
    | "stats"
    | "workHistory"
  >;

  try {
    result = await db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(agency_metadata)
        .set({
          name: input.name,
          professional_title: input.professionalTitle,
          size: input.size,
          specialty: input.specialty,
          website: input.website || null,
          overview: input.overview,
          tags: input.tags,
          avatar_image: avatarImage ?? existing.avatarImage,
          is_onboarded: true,
          updated_at: new Date(),
        })
        .where(eq(agency_metadata.owner_id, input.ownerId))
        .returning(agencyColumns);

      if (!updated) {
        throw new ApiError(500, "The agency profile could not be saved.");
      }

      await transaction
        .delete(agency_portfolios)
        .where(eq(agency_portfolios.agency_id, updated.id));

      const portfolioRows = portfolio.length
        ? await transaction
            .insert(agency_portfolios)
            .values(
              portfolio.map((item) => ({
                agency_id: updated.id,
                title: item.title,
                category: item.category,
                description: item.description,
                live_url: item.liveUrl || null,
                cover_image: item.coverImage,
              })),
            )
            .returning({
              id: agency_portfolios.id,
              title: agency_portfolios.title,
              category: agency_portfolios.category,
              description: agency_portfolios.description,
              liveUrl: agency_portfolios.live_url,
              coverImage: agency_portfolios.cover_image,
            })
        : [];

      return {
        ...updated,
        avatarImage: updated.avatarImage ?? null,
        portfolio: portfolioRows,
      };
    });
  } catch (error) {
    await Promise.allSettled(
      uploadedFileIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }

  if (!existing.isOnboarded) {
    try {
      const balance = await addAgencyConnects(result.id);
      if (balance) {
        await sendNotification({
          agencyId: result.id,
          type: "AGENCY_WELCOME_BONUS",
          title: "Welcome Connects added",
          message: `Your agency received ${INITIAL_CONNECTS} welcome Connects.`,
          link: "/finances?section=connects",
          metadata: { connects: INITIAL_CONNECTS },
        });
      }
    } catch (error) {
      await logger.error({
        message: "Onboarding connects could not be added",
        eventName: "connects.onboarding.failed",
        attributes: {
          "account.type": "agency",
          "error.name": error instanceof Error ? error.name : "UnknownError",
          ...errorLogAttributes(error),
        },
      });
    }
  }

  const retainedImageIds = new Set(
    [
      result.avatarImage?.imageId,
      ...result.portfolio.map((item) => item.coverImage.imageId),
    ].filter((id): id is string => Boolean(id)),
  );

  const staleImageIds = [
    existing.avatarImage?.imageId,
    ...existing.portfolio.map((item) => item.coverImage.imageId),
  ].filter(
    (id): id is string => Boolean(id) && !retainedImageIds.has(id as string),
  );

  await Promise.allSettled(
    staleImageIds.map((fileId) => imageKit.files.delete(fileId)),
  );

  return attachOwnerProfile(input.ownerId, result);
};

export const getAgencyTags = async (
  freelancerId: string,
): Promise<string[] | null> => {
  const agencyId = await getAgencyIdForMember(freelancerId);
  if (!agencyId) return null;

  const [agency] = await db
    .select({ tags: agency_metadata.tags })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);

  return agency?.tags ?? null;
};

export const getAgencyIdentityForOwner = async (
  ownerId: string,
): Promise<{ id: string; name: string } | null> => {
  const [agency] = await db
    .select({ id: agency_metadata.id, name: agency_metadata.name })
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId))
    .limit(1);

  return agency ?? null;
};

export const getAgencyIdForMember = async (
  freelancerId: string,
  executor: DbExecutor = db,
): Promise<string | null> => {
  const [membership] = await executor
    .select({ agencyId: agency_members.agency_id })
    .from(agency_members)
    .where(eq(agency_members.freelancer_id, freelancerId))
    .limit(1);

  return membership?.agencyId ?? null;
};

export const requireAgencyPermission = async (
  userId: string,
  permission: AgencyPermission,
  executor: DbExecutor = db,
): Promise<{ agencyId: string | null; role: string | null }> => {
  const [membership] = await executor
    .select({
      agencyId: agency_members.agency_id,
      role: agency_members.role,
    })
    .from(agency_members)
    .where(eq(agency_members.freelancer_id, userId))
    .limit(1);
  const [owned] = await executor
    .select({ id: agency_metadata.id })
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, userId))
    .limit(1);

  const agencyId = membership?.agencyId ?? owned?.id ?? null;
  if (!agencyId) return { agencyId: null, role: null };

  const isOwner = owned?.id === agencyId;
  const role = membership?.agencyId === agencyId ? membership.role : "";
  if (!isAgencyRoleAllowed(permission, { isOwner, role })) {
    throw new ApiError(
      403,
      "Your agency role does not allow this action.",
      "AGENCY_PERMISSION_DENIED",
    );
  }
  return { agencyId, role };
};

export const getAgencyOwnerVerification = async (
  agencyId: string,
): Promise<{ ownerId: string; identityVerified: boolean } | null> => {
  const [owner] = await db
    .select({
      ownerId: agency_metadata.owner_id,
      identityVerified: accounts.identityVerified,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);

  return owner
    ? { ...owner, identityVerified: owner.identityVerified === true }
    : null;
};

export const getAgencyOwnerId = async (
  agencyId: string,
): Promise<string | null> => {
  const [agency] = await db
    .select({ ownerId: agency_metadata.owner_id })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);

  return agency?.ownerId ?? null;
};

export const getAgencyTeamMemberIds = async (
  agencyId: string,
): Promise<string[]> => {
  const [ownerId, members] = await Promise.all([
    getAgencyOwnerId(agencyId),
    db
      .select({ freelancerId: agency_members.freelancer_id })
      .from(agency_members)
      .where(eq(agency_members.agency_id, agencyId)),
  ]);

  return [
    ...new Set(
      [ownerId, ...members.map((member) => member.freelancerId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
};

export interface AgencyInvitationData {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  avatarUrl: string | null;
}

export const getAgencyInvitations = async (
  agencyId: string,
): Promise<AgencyInvitationData[]> => {
  const rows = await db
    .select({
      id: agency_invitations.id,
      email: agency_invitations.email,
      role: agency_invitations.role,
      status: agency_invitations.status,
      createdAt: agency_invitations.created_at,
    })
    .from(agency_invitations)
    .where(
      and(
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .orderBy(desc(agency_invitations.created_at));

  return rows.map((row) => ({ ...row, avatarUrl: null }));
};

const INVITATION_RESEND_COOLDOWN_SECONDS = 60;

const notifyInvitee = async (
  email: string,
  agencyId: string,
  agencyName: string,
) => {
  const [account] = await db
    .select({ authId: accounts.auth_id, role: accounts.role })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);

  if (!account || account.role !== "FREELANCER") return;
  if (await getAgencyIdForMember(account.authId)) return;

  try {
    await sendNotification({
      recipientId: account.authId,
      type: "AGENCY_INVITATION",
      title: "You've been invited to join an agency",
      message: `${agencyName} invited you to join their agency team.`,
      link: "/agency-invitations",
      metadata: { agencyId },
    });
  } catch (error) {
    await logger
      .warn({
        message: "Agency invitation notification failed",
        eventName: "task.agency.invitation_notify_failed",
        attributes: errorLogAttributes(error),
      })
      .catch(() => {});
  }
};

export const inviteAgencyMember = async (
  agencyId: string,
  agencyName: string,
  invitedBy: string,
  input: { email: string; role: string },
): Promise<AgencyInvitationData> => {
  const email = input.email.trim().toLowerCase();

  const [existingMember] = await db
    .select({ id: agency_members.id })
    .from(agency_members)
    .innerJoin(accounts, eq(accounts.auth_id, agency_members.freelancer_id))
    .where(
      and(eq(accounts.email, email), eq(agency_members.agency_id, agencyId)),
    )
    .limit(1);
  if (existingMember) {
    throw new ApiError(
      409,
      "This person is already part of your agency team.",
      "INVITEE_ALREADY_MEMBER",
    );
  }

  const [existingInvite] = await db
    .select({ id: agency_invitations.id })
    .from(agency_invitations)
    .where(
      and(
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.email, email),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .limit(1);
  if (existingInvite) {
    throw new ApiError(
      409,
      "An invitation is already pending for this email.",
      "INVITATION_ALREADY_PENDING",
    );
  }

  const [invitation] = await db
    .insert(agency_invitations)
    .values({
      agency_id: agencyId,
      email,
      role: input.role,
      invited_by: invitedBy,
    })
    .returning({
      id: agency_invitations.id,
      email: agency_invitations.email,
      role: agency_invitations.role,
      status: agency_invitations.status,
      createdAt: agency_invitations.created_at,
    });

  if (!invitation) throw new ApiError(500, "The invitation could not be sent.");

  await notifyInvitee(email, agencyId, agencyName);

  return { ...invitation, avatarUrl: null };
};

export const cancelAgencyInvitation = async (
  agencyId: string,
  invitationId: string,
) => {
  const [cancelled] = await db
    .update(agency_invitations)
    .set({
      status: "CANCELLED",
      responded_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(agency_invitations.id, invitationId),
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .returning({ id: agency_invitations.id });

  if (!cancelled) throw new ApiError(404, "Invitation not found.");
};

export const resendAgencyInvitation = async (
  agencyId: string,
  invitationId: string,
  agencyName: string,
) => {
  const [invitation] = await db
    .update(agency_invitations)
    .set({ updated_at: sql`now()` })
    .where(
      and(
        eq(agency_invitations.id, invitationId),
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.status, "PENDING"),
        sql`${agency_invitations.updated_at} <= now() - make_interval(secs => ${INVITATION_RESEND_COOLDOWN_SECONDS})`,
      ),
    )
    .returning({ email: agency_invitations.email });

  if (!invitation) {
    const [pending] = await db
      .select({ id: agency_invitations.id })
      .from(agency_invitations)
      .where(
        and(
          eq(agency_invitations.id, invitationId),
          eq(agency_invitations.agency_id, agencyId),
          eq(agency_invitations.status, "PENDING"),
        ),
      )
      .limit(1);
    if (!pending) throw new ApiError(404, "Invitation not found.");
    throw new ApiError(
      429,
      `Please wait ${INVITATION_RESEND_COOLDOWN_SECONDS} seconds before resending this invitation.`,
      "INVITATION_RESEND_COOLDOWN",
    );
  }

  await notifyInvitee(invitation.email, agencyId, agencyName);
};

export const updateAgencyInvitationRole = async (
  agencyId: string,
  invitationId: string,
  role: string,
) => {
  const [updated] = await db
    .update(agency_invitations)
    .set({ role, updated_at: new Date() })
    .where(
      and(
        eq(agency_invitations.id, invitationId),
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .returning({ id: agency_invitations.id });

  if (!updated) throw new ApiError(404, "Invitation not found.");
};

export const updateAgencyMemberRole = async (
  agencyId: string,
  memberId: string,
  role: string,
) => {
  const [member] = await db
    .select({
      freelancerId: agency_members.freelancer_id,
      ownerId: agency_metadata.owner_id,
    })
    .from(agency_members)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_members.agency_id),
    )
    .where(
      and(
        eq(agency_members.id, memberId),
        eq(agency_members.agency_id, agencyId),
      ),
    )
    .limit(1);

  if (!member) throw new ApiError(404, "Agency member not found.");
  if (member.freelancerId === member.ownerId) {
    throw new ApiError(400, "The agency owner's role cannot be changed.");
  }

  await db
    .update(agency_members)
    .set({ role })
    .where(eq(agency_members.id, memberId));
};

export const removeAgencyMember = async (
  agencyId: string,
  memberId: string,
) => {
  const [member] = await db
    .select({
      freelancerId: agency_members.freelancer_id,
      ownerId: agency_metadata.owner_id,
    })
    .from(agency_members)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_members.agency_id),
    )
    .where(
      and(
        eq(agency_members.id, memberId),
        eq(agency_members.agency_id, agencyId),
      ),
    )
    .limit(1);

  if (!member) throw new ApiError(404, "Agency member not found.");
  if (member.freelancerId === member.ownerId) {
    throw new ApiError(400, "The agency owner cannot be removed.");
  }

  await db.delete(agency_members).where(eq(agency_members.id, memberId));
};

export interface MyAgencyInvitation {
  id: string;
  agencyId: string;
  agencyName: string;
  agencyAvatar: { imageId: string; url: string } | null;
  role: string;
  createdAt: Date;
}

export const getMyAgencyInvitations = async (
  userId: string,
): Promise<MyAgencyInvitation[]> => {
  const [account] = await db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.auth_id, userId))
    .limit(1);
  if (!account) return [];

  return db
    .select({
      id: agency_invitations.id,
      agencyId: agency_invitations.agency_id,
      agencyName: agency_metadata.name,
      agencyAvatar: agency_metadata.avatar_image,
      role: agency_invitations.role,
      createdAt: agency_invitations.created_at,
    })
    .from(agency_invitations)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_invitations.agency_id),
    )
    .where(
      and(
        eq(agency_invitations.email, account.email),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .orderBy(desc(agency_invitations.created_at));
};

export const respondToAgencyInvitation = async (
  invitationId: string,
  userId: string,
  accept: boolean,
) => {
  const [account] = await db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.auth_id, userId))
    .limit(1);
  if (!account) throw new ApiError(404, "Account not found.");

  const [invitation] = await db
    .select({
      id: agency_invitations.id,
      agencyId: agency_invitations.agency_id,
      agencyName: agency_metadata.name,
      role: agency_invitations.role,
      email: agency_invitations.email,
      status: agency_invitations.status,
    })
    .from(agency_invitations)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_invitations.agency_id),
    )
    .where(eq(agency_invitations.id, invitationId))
    .limit(1);

  if (!invitation || invitation.email !== account.email) {
    throw new ApiError(404, "Invitation not found.");
  }

  const now = new Date();

  const resolveInvitation = (executor: DbExecutor) =>
    executor
      .update(agency_invitations)
      .set({
        status: accept ? "ACCEPTED" : "DECLINED",
        responded_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(agency_invitations.id, invitationId),
          eq(agency_invitations.status, "PENDING"),
        ),
      )
      .returning({
        agencyId: agency_invitations.agency_id,
        role: agency_invitations.role,
      });

  if (accept) {
    try {
      await db.transaction(async (transaction) => {
        const [resolved] = await resolveInvitation(transaction);
        if (!resolved) throw invitationHandledError();

        await transaction.insert(agency_members).values({
          agency_id: resolved.agencyId,
          freelancer_id: userId,
          role: resolved.role,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, AGENCY_MEMBER_UNIQUE)) {
        throw alreadyInAgencyError(ALREADY_IN_AGENCY_MESSAGE);
      }
      throw error;
    }
  } else {
    const [resolved] = await resolveInvitation(db);
    if (!resolved) throw invitationHandledError();
  }

  const ownerId = await getAgencyOwnerId(invitation.agencyId);
  if (ownerId) {
    let responderName = account.email;
    if (env.clerkSecretKey) {
      try {
        const user = await clerk.users.getUser(userId);
        responderName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          account.email;
      } catch {
        // Clerk lookup is best-effort — fall back to the email already on hand.
      }
    }

    await sendNotification({
      agencyId: invitation.agencyId,
      type: accept
        ? "AGENCY_INVITATION_ACCEPTED"
        : "AGENCY_INVITATION_DECLINED",
      title: accept ? "Invitation accepted" : "Invitation declined",
      message: accept
        ? `${responderName} accepted your invitation to join ${invitation.agencyName}.`
        : `${responderName} declined your invitation to join ${invitation.agencyName}.`,
      link: "/team",
      metadata: { invitationId },
    });
  }

  return { accepted: accept };
};

export interface PublicAgencySummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  tagline: string | null;
  description: string;
  specialty: string;
  location: string | null;
  teamSize: string;
  memberCount: number;
  minHourlyRateCents: number | null;
  rating: number;
  reviews: number;
  projects: number;
  success: number;
  skills: string[];
}

export interface PublicAgencyFilters {
  query?: string;
  specialty?: string;
  sizes?: string[];
  verifiedOnly?: boolean;
  maxRateCents?: number;
  sort?: "recommended" | "rating" | "projects" | "rate-low";
}

export interface PublicAgencyFeedPage {
  results: PublicAgencySummary[];
  hasMore: boolean;
}

const PUBLIC_AGENCY_PAGE_SIZE = 20;
const publicAgencyRegionNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

export const searchPublicAgencies = async (
  filters: PublicAgencyFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicAgencyFeedPage> => {
  const limit = pagination.limit ?? PUBLIC_AGENCY_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const memberCountExpr = sql<number>`(
    SELECT count(*) FROM ${agency_members}
    WHERE ${agency_members.agency_id} = ${agency_metadata.id}
  )`;
  const minHourlyRateExpr = sql<string | null>`(
    SELECT min(${freelancer_metadata.hourly_rate_cents}) FROM ${agency_members}
    INNER JOIN ${freelancer_metadata}
      ON ${freelancer_metadata.auth_id} = ${agency_members.freelancer_id}
    WHERE ${agency_members.agency_id} = ${agency_metadata.id}
  )`;

  const conditions = [eq(agency_metadata.is_onboarded, true)];
  if (filters.specialty) {
    conditions.push(eq(agency_metadata.specialty, filters.specialty));
  }
  if (filters.sizes?.length) {
    conditions.push(inArray(agency_metadata.size, filters.sizes));
  }
  if (filters.verifiedOnly) {
    conditions.push(eq(accounts.identityVerified, true));
  }
  if (filters.maxRateCents) {
    conditions.push(sql`${minHourlyRateExpr} <= ${filters.maxRateCents}`);
  }

  const orderBy = (() => {
    switch (filters.sort) {
      case "rating":
        return desc(agency_earning.rating);
      case "projects":
        return desc(agency_earning.completed_jobs);
      case "rate-low":
        return asc(minHourlyRateExpr);
      default:
        return desc(
          sql`${agency_earning.rating} * ${agency_earning.job_success_score}`,
        );
    }
  })();

  const rows = await db
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      professionalTitle: agency_metadata.professional_title,
      specialty: agency_metadata.specialty,
      overview: agency_metadata.overview,
      size: agency_metadata.size,
      tags: agency_metadata.tags,
      avatarImage: agency_metadata.avatar_image,
      identityVerified: accounts.identityVerified,
      ownerCity: freelancer_metadata.city,
      ownerCountry: freelancer_metadata.country,
      rating: agency_earning.rating,
      jobSuccessScore: agency_earning.job_success_score,
      completedJobs: agency_earning.completed_jobs,
      reviewCount: agency_earning.review_count,
      memberCount: memberCountExpr,
      minHourlyRateCents: minHourlyRateExpr,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .leftJoin(
      freelancer_metadata,
      eq(freelancer_metadata.auth_id, agency_metadata.owner_id),
    )
    .leftJoin(agency_earning, eq(agency_earning.agency_id, agency_metadata.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const hasMore = rows.length === limit;
  if (!rows.length) return { results: [], hasMore: false };

  const results: PublicAgencySummary[] = [];
  for (const row of rows) {
    const countryName = row.ownerCountry
      ? (publicAgencyRegionNames.of(row.ownerCountry) ?? row.ownerCountry)
      : null;
    const location = [row.ownerCity, countryName].filter(Boolean).join(", ");
    const searchable = [
      row.name,
      row.professionalTitle,
      row.specialty,
      location,
      ...row.tags,
    ]
      .join(" ")
      .toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;

    results.push({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatarImage?.url ?? null,
      verified: row.identityVerified === true,
      tagline: row.professionalTitle,
      description: row.overview,
      specialty: row.specialty,
      location: location || null,
      teamSize: row.size,
      memberCount: Number(row.memberCount),
      minHourlyRateCents:
        row.minHourlyRateCents !== null
          ? toSafeCents(row.minHourlyRateCents)
          : null,
      rating: Number(row.rating ?? 0),
      reviews: Number(row.reviewCount ?? 0),
      projects: Number(row.completedJobs ?? 0),
      success: Math.round(Number(row.jobSuccessScore ?? 0)),
      skills: row.tags,
    });
  }

  return { results, hasMore };
};
