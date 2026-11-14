import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { agency_members, agency_metadata } from "../agency/agency.schema.js";
import { client_metadata } from "../client/client.schema.js";
import {
  contracts,
  freelancer_earning,
  reviews,
} from "../contracts/contracts.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import {
  freelancer_metadata,
  freelancer_portfolios,
} from "./freelancer.schema.js";

export type FreelancerMetadataValues = Omit<
  typeof freelancer_metadata.$inferInsert,
  "auth_id"
>;

export const findFreelancerWithAccount = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [result] = await executor
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
  return result;
};

export const listPortfoliosOfFreelancer = (
  executor: DbExecutor,
  freelancerProfileId: string,
) =>
  executor
    .select()
    .from(freelancer_portfolios)
    .where(eq(freelancer_portfolios.freelancer_id, freelancerProfileId));

export const findEarningStats = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [earningStats] = await executor
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
  return earningStats;
};

export const listActiveOrCompletedContractsOfFreelancer = (
  executor: DbExecutor,
  userId: string,
) =>
  executor
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

export const listReviewsOfContract = (
  executor: DbExecutor,
  contractId: string,
) =>
  executor
    .select({
      reviewerId: reviews.reviewer_id,
      revieweeId: reviews.reviewee_id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.created_at,
    })
    .from(reviews)
    .where(eq(reviews.contract_id, contractId));

export const findAgencyIdentityOfMember = async (
  executor: DbExecutor,
  freelancerId: string,
) => {
  const [agency] = await executor
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      avatarImage: agency_metadata.avatar_image,
    })
    .from(agency_members)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_members.agency_id),
    )
    .where(eq(agency_members.freelancer_id, freelancerId))
    .limit(1);
  return agency;
};

export const findFreelancerAuthIdByProfileId = async (
  executor: DbExecutor,
  profileId: string,
) => {
  const [freelancer] = await executor
    .select({ userId: freelancer_metadata.auth_id })
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.id, profileId))
    .limit(1);
  return freelancer;
};

export const findFreelancerSkills = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [profile] = await executor
    .select({ skills: freelancer_metadata.skills })
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.auth_id, userId));
  return profile;
};

export const listStoredPortfolioCoverImages = (
  executor: DbExecutor,
  authId: string,
) =>
  executor
    .select({ cover_image: freelancer_portfolios.cover_image })
    .from(freelancer_portfolios)
    .innerJoin(
      freelancer_metadata,
      eq(freelancer_portfolios.freelancer_id, freelancer_metadata.id),
    )
    .where(eq(freelancer_metadata.auth_id, authId));

export const findFreelancerLocation = async (
  executor: DbExecutor,
  authId: string,
) => {
  const [existingMetadata] = await executor
    .select({
      country: freelancer_metadata.country,
      city: freelancer_metadata.city,
    })
    .from(freelancer_metadata)
    .where(eq(freelancer_metadata.auth_id, authId));
  return existingMetadata;
};

export const upsertFreelancerMetadata = async (
  executor: DbExecutor,
  authId: string,
  values: FreelancerMetadataValues,
) => {
  const [metadata] = await executor
    .insert(freelancer_metadata)
    .values({ auth_id: authId, ...values })
    .onConflictDoUpdate({
      target: freelancer_metadata.auth_id,
      set: values,
    })
    .returning();
  return metadata;
};

export const deletePortfoliosOfFreelancer = async (
  executor: DbExecutor,
  freelancerProfileId: string,
) => {
  await executor
    .delete(freelancer_portfolios)
    .where(eq(freelancer_portfolios.freelancer_id, freelancerProfileId));
};

export const insertPortfolios = (
  executor: DbExecutor,
  rows: (typeof freelancer_portfolios.$inferInsert)[],
) => executor.insert(freelancer_portfolios).values(rows).returning();
