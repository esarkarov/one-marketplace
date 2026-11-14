import { randomUUID } from "crypto";
import { clerk } from "../../infrastructure/clerk.js";
import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../database/pg-errors.js";
import { ApiError } from "../../shared/http/api-error.js";
import { imageKit } from "../../infrastructure/image-kit.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import { addAgencyConnects } from "../connects/connects.public.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";
import { INITIAL_CONNECTS } from "../../config/constants.js";
import { getJSSContribution } from "../freelancer/freelancer.public.js";
import {
  isImageDataUrl,
  reuseStoredImage,
  type StoredImage,
} from "../../shared/uploads/portfolio-images.js";
import {
  AgencyPortfolioItem,
  AgencyMember,
  AgencyWorkHistoryItem,
  AgencyStats,
  AgencyData,
  CreateAgencyInput,
  ImageInput,
  UpdateAgencyInput,
} from "./agency.types.js";
import {
  AGENCY_MEMBER_UNIQUE,
  AGENCY_OWNER_UNIQUE,
  alreadyInAgencyError,
  ALREADY_IN_AGENCY_MESSAGE,
} from "./agency.errors.js";
import { getAgencyIdForMember } from "./agency.membership.service.js";
import {
  deletePortfolioOfAgency,
  findAgencyByOwner,
  findAgencyEarningStats,
  findAgencyIdentityByOwner,
  findAgencyOwnerVerification,
  findAgencyTags,
  findAgencyWithOwnerId,
  insertAgency,
  insertAgencyMember,
  insertAgencyPortfolios,
  listActiveOrCompletedContractsOfAgency,
  listAgencyMemberRows,
  listContractReviewRatings,
  listPortfolioOfAgency,
  updateAgencyProfileByOwner,
} from "./agency.repository.js";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

const getAgencyPortfolio = async (
  agencyId: string,
): Promise<AgencyPortfolioItem[]> => listPortfolioOfAgency(db, agencyId);

const getAgencyWorkHistoryAndStats = async (
  agencyId: string,
): Promise<{ stats: AgencyStats; workHistory: AgencyWorkHistoryItem[] }> => {
  const earningStats = await findAgencyEarningStats(db, agencyId);

  const agencyContracts = await listActiveOrCompletedContractsOfAgency(
    db,
    agencyId,
  );

  const workHistory: AgencyWorkHistoryItem[] = await Promise.all(
    agencyContracts.map(async ({ contract, companyName }) => {
      const contractReviews = await listContractReviewRatings(db, contract.id);

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
  const memberRows = await listAgencyMemberRows(db, agency.id);

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
  const agency = await findAgencyByOwner(db, ownerId);

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
  const agency = await findAgencyWithOwnerId(db, agencyId);

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
      const row = await insertAgency(transaction, {
        ownerId: input.ownerId,
        name: input.name,
        size: input.size,
        specialty: input.specialty,
        website: input.website || null,
        overview: input.overview,
        now,
      });

      if (!row) {
        throw new ApiError(500, "The agency could not be created.");
      }

      await insertAgencyMember(transaction, {
        agencyId: row.id,
        freelancerId: input.ownerId,
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
      const updated = await updateAgencyProfileByOwner(
        transaction,
        input.ownerId,
        {
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
        },
      );

      if (!updated) {
        throw new ApiError(500, "The agency profile could not be saved.");
      }

      await deletePortfolioOfAgency(transaction, updated.id);

      const portfolioRows = portfolio.length
        ? await insertAgencyPortfolios(
            transaction,
            portfolio.map((item) => ({
              agency_id: updated.id,
              title: item.title,
              category: item.category,
              description: item.description,
              live_url: item.liveUrl || null,
              cover_image: item.coverImage,
            })),
          )
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

  const agency = await findAgencyTags(db, agencyId);

  return agency?.tags ?? null;
};

export const getAgencyIdentityForOwner = async (
  ownerId: string,
): Promise<{ id: string; name: string } | null> => {
  const agency = await findAgencyIdentityByOwner(db, ownerId);

  return agency ?? null;
};

export const getAgencyOwnerVerification = async (
  agencyId: string,
): Promise<{ ownerId: string; identityVerified: boolean } | null> => {
  const owner = await findAgencyOwnerVerification(db, agencyId);

  return owner
    ? { ...owner, identityVerified: owner.identityVerified === true }
    : null;
};
