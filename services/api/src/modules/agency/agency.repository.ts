import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import {
  agency_earning,
  contracts,
  freelancer_earning,
  reviews,
} from "../contracts/contracts.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import {
  agency_members,
  agency_metadata,
  agency_portfolios,
} from "./agency.schema.js";

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

const portfolioColumns = {
  id: agency_portfolios.id,
  title: agency_portfolios.title,
  category: agency_portfolios.category,
  description: agency_portfolios.description,
  liveUrl: agency_portfolios.live_url,
  coverImage: agency_portfolios.cover_image,
};

export const listPortfolioOfAgency = (executor: DbExecutor, agencyId: string) =>
  executor
    .select(portfolioColumns)
    .from(agency_portfolios)
    .where(eq(agency_portfolios.agency_id, agencyId));

export const findAgencyEarningStats = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [earningStats] = await executor
    .select({
      totalEarningCents: agency_earning.total_earning_cents,
      completedJobs: agency_earning.completed_jobs,
      ongoingJobs: agency_earning.ongoing_jobs,
    })
    .from(agency_earning)
    .where(eq(agency_earning.agency_id, agencyId))
    .limit(1);
  return earningStats;
};

export const listActiveOrCompletedContractsOfAgency = (
  executor: DbExecutor,
  agencyId: string,
) =>
  executor
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

export const listContractReviewRatings = (
  executor: DbExecutor,
  contractId: string,
) =>
  executor
    .select({
      reviewerId: reviews.reviewer_id,
      rating: reviews.rating,
      comment: reviews.comment,
    })
    .from(reviews)
    .where(eq(reviews.contract_id, contractId));

export const listAgencyMemberRows = (executor: DbExecutor, agencyId: string) =>
  executor
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
    .where(eq(agency_members.agency_id, agencyId))
    .orderBy(agency_members.created_at);

export const findAgencyByOwner = async (
  executor: DbExecutor,
  ownerId: string,
) => {
  const [agency] = await executor
    .select(agencyColumns)
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId))
    .limit(1);
  return agency;
};

export const findAgencyWithOwnerId = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [agency] = await executor
    .select({ ...agencyColumns, ownerId: agency_metadata.owner_id })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return agency;
};

export const insertAgency = async (
  executor: DbExecutor,
  values: {
    ownerId: string;
    name: string;
    size: string;
    specialty: string;
    website: string | null;
    overview: string;
    now: Date;
  },
) => {
  const [row] = await executor
    .insert(agency_metadata)
    .values({
      owner_id: values.ownerId,
      name: values.name,
      size: values.size,
      specialty: values.specialty,
      website: values.website,
      overview: values.overview,
      created_at: values.now,
      updated_at: values.now,
    })
    .returning(agencyColumns);
  return row;
};

export const insertAgencyMember = async (
  executor: DbExecutor,
  values: { agencyId: string; freelancerId: string; role: string },
) => {
  await executor.insert(agency_members).values({
    agency_id: values.agencyId,
    freelancer_id: values.freelancerId,
    role: values.role,
  });
};

export const updateAgencyProfileByOwner = async (
  executor: DbExecutor,
  ownerId: string,
  values: Partial<typeof agency_metadata.$inferInsert>,
) => {
  const [updated] = await executor
    .update(agency_metadata)
    .set(values)
    .where(eq(agency_metadata.owner_id, ownerId))
    .returning(agencyColumns);
  return updated;
};

export const deletePortfolioOfAgency = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  await executor
    .delete(agency_portfolios)
    .where(eq(agency_portfolios.agency_id, agencyId));
};

export const insertAgencyPortfolios = (
  executor: DbExecutor,
  rows: (typeof agency_portfolios.$inferInsert)[],
) =>
  executor.insert(agency_portfolios).values(rows).returning(portfolioColumns);

export const findAgencyTags = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [agency] = await executor
    .select({ tags: agency_metadata.tags })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return agency;
};

export const findAgencyIdentityByOwner = async (
  executor: DbExecutor,
  ownerId: string,
) => {
  const [agency] = await executor
    .select({ id: agency_metadata.id, name: agency_metadata.name })
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId))
    .limit(1);
  return agency;
};

export const findAgencyOwnerVerification = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [owner] = await executor
    .select({
      ownerId: agency_metadata.owner_id,
      identityVerified: accounts.identityVerified,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return owner;
};

export const findAgencyIdOfMember = async (
  executor: DbExecutor,
  freelancerId: string,
) => {
  const [membership] = await executor
    .select({ agencyId: agency_members.agency_id })
    .from(agency_members)
    .where(eq(agency_members.freelancer_id, freelancerId))
    .limit(1);
  return membership;
};

export const findMembershipOfUser = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [membership] = await executor
    .select({
      agencyId: agency_members.agency_id,
      role: agency_members.role,
    })
    .from(agency_members)
    .where(eq(agency_members.freelancer_id, userId))
    .limit(1);
  return membership;
};

export const findOwnedAgencyId = async (
  executor: DbExecutor,
  ownerId: string,
) => {
  const [owned] = await executor
    .select({ id: agency_metadata.id })
    .from(agency_metadata)
    .where(eq(agency_metadata.owner_id, ownerId))
    .limit(1);
  return owned;
};

export const findAgencyOwnerId = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [agency] = await executor
    .select({ ownerId: agency_metadata.owner_id })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return agency;
};

export const listAgencyMemberFreelancerIds = (
  executor: DbExecutor,
  agencyId: string,
) =>
  executor
    .select({ freelancerId: agency_members.freelancer_id })
    .from(agency_members)
    .where(eq(agency_members.agency_id, agencyId));

export const findAgencyMemberWithOwner = async (
  executor: DbExecutor,
  agencyId: string,
  memberId: string,
) => {
  const [member] = await executor
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
  return member;
};

export const setAgencyMemberRole = async (
  executor: DbExecutor,
  memberId: string,
  role: string,
) => {
  await executor
    .update(agency_members)
    .set({ role })
    .where(eq(agency_members.id, memberId));
};

export const deleteAgencyMember = async (
  executor: DbExecutor,
  memberId: string,
) => {
  await executor.delete(agency_members).where(eq(agency_members.id, memberId));
};
