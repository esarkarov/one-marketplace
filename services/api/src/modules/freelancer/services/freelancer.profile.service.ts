import { db } from "../../../database/client.js";
import { markFreelancerOnboardingComplete } from "../../auth/index.js";
import {
  deletePortfoliosOfFreelancer,
  findEarningStats,
  findFreelancerAuthIdByProfileId,
  findFreelancerLocation,
  findFreelancerWithAccount,
  insertPortfolios,
  listActiveOrCompletedContractsOfFreelancer,
  listPortfoliosOfFreelancer,
  listReviewsOfContract,
  listStoredPortfolioCoverImages,
  upsertFreelancerMetadata,
} from "../repositories/freelancer.repository.js";
import {
  FreelancerProfileData,
  PortfolioData,
  SaveFreelancerProfileInput,
} from "../types/freelancer.types.js";
import { getAgencyIdentityForMember } from "./freelancer.agency-identity.service.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { errorLogAttributes } from "../../../shared/logging/sanitize-log.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { imageKit } from "../../../infrastructure/storage/image-kit.js";
import { randomUUID } from "crypto";
import { invalidateAccountAuthCache } from "../../../infrastructure/cache/account-auth-cache.js";
import { addConnects } from "../../connects/index.js";
import { clerk } from "../../../infrastructure/auth/clerk.js";
import {
  isImageDataUrl,
  reuseStoredImage,
} from "../../../shared/uploads/portfolio-images.js";
import { getJSSContribution } from "./freelancer.jobs.service.js";

export const getFreelancerProfile = async (
  userId: string,
): Promise<FreelancerProfileData | null> => {
  const result = await findFreelancerWithAccount(db, userId);

  if (!result) return null;

  const profile = result.freelancer_metadata;

  const portfolios = await listPortfoliosOfFreelancer(db, profile.id);

  const earningStats = await findEarningStats(db, userId);

  const userContracts = await listActiveOrCompletedContractsOfFreelancer(
    db,
    userId,
  );

  const workHistory = await Promise.all(
    userContracts.map(async ({ contract, companyName, skills }) => {
      const contractReviews = await listReviewsOfContract(db, contract.id);

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
  const existingImages = await listStoredPortfolioCoverImages(db, input.userId);

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
      const account = await markFreelancerOnboardingComplete(
        transaction,
        input.userId,
      );

      if (!account) throw new ApiError(404, "Freelancer account not found.");

      let country = input.country;
      let city = input.city;

      if (account.identityVerified) {
        const existingMetadata = await findFreelancerLocation(
          transaction,
          input.userId,
        );

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

      const metadata = await upsertFreelancerMetadata(
        transaction,
        input.userId,
        metadataValues,
      );

      if (!metadata) {
        throw new ApiError(500, "Freelancer profile could not be saved.");
      }

      await deletePortfoliosOfFreelancer(transaction, metadata.id);

      const portfolios = await insertPortfolios(
        transaction,
        uploadedPortfolios.map((portfolio) => ({
          freelancer_id: metadata.id,
          ...portfolio,
        })),
      );

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

export const getPublicFreelancerProfile = async (profileId: string) => {
  const freelancer = await findFreelancerAuthIdByProfileId(db, profileId);
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
