import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import {
  agency_earning,
  client_spents,
  contract_milestones,
  contracts,
  freelancer_earning,
  reviews,
} from "../contracts/contracts.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { client_metadata } from "./client.schema.js";
import {
  conversation_participants,
  messages,
} from "../messaging/messaging.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import { proposals } from "../proposals/proposals.schema.js";

export interface ClientMetadataInput {
  userId: string;
  professionalRole: string;
  companyName: string;
  companyWebsite: string;
  companySize: string;
  industry: string;
  companyDescription: string;
}

export const findClientProfile = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [profile] = await executor
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
  return profile;
};

export const upsertClientMetadata = async (
  executor: DbExecutor,
  input: ClientMetadataInput,
  now: Date,
) => {
  const [savedProfile] = await executor
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
  return savedProfile;
};

export const findClientSpendForOverview = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [spend] = await executor
    .select({
      totalSpentCents: client_spents.total_spent_cents,
      completedContracts: client_spents.completed_contracts,
      ongoingContracts: client_spents.ongoing_contracts,
      rating: client_spents.rating,
    })
    .from(client_spents)
    .where(eq(client_spents.client_id, clientId))
    .limit(1);
  return spend;
};

export const findClientSpendForDashboard = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [spend] = await executor
    .select({
      totalSpentCents: client_spents.total_spent_cents,
      ongoingContracts: client_spents.ongoing_contracts,
      completedContracts: client_spents.completed_contracts,
    })
    .from(client_spents)
    .where(eq(client_spents.client_id, clientId))
    .limit(1);
  return spend;
};

export const countPublishedJobsOfClient = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [openJobsRow] = await executor
    .select({ value: count() })
    .from(job_posts)
    .where(
      and(eq(job_posts.client_id, clientId), eq(job_posts.status, "PUBLISHED")),
    );
  return openJobsRow;
};

export const countJobsOfClient = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [totalJobsRow] = await executor
    .select({ value: count() })
    .from(job_posts)
    .where(eq(job_posts.client_id, clientId));
  return totalJobsRow;
};

export const findProposalStatsOfClient = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [proposalStats] = await executor
    .select({
      total: count(),
      submitted: sql<number>`count(*) filter (where ${proposals.status} = 'SUBMITTED')`,
      shortlisted: sql<number>`count(*) filter (where ${proposals.status} = 'SUBMITTED' and ${proposals.is_shortlisted})`,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .where(eq(job_posts.client_id, clientId));
  return proposalStats;
};

export const findActiveContractProgressRows = (
  executor: DbExecutor,
  clientId: string,
) => {
  return executor
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
};

export const findLatestPublishedJobsWithProposalCounts = (
  executor: DbExecutor,
  clientId: string,
) => {
  return executor
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
};

export const findCompletedContractsOfClient = (
  executor: DbExecutor,
  clientId: string,
) => {
  return executor
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
};

export const findReviewsForContracts = (
  executor: DbExecutor,
  contractIds: string[],
) => {
  return executor
    .select({
      contractId: reviews.contract_id,
      reviewerId: reviews.reviewer_id,
      rating: reviews.rating,
      comment: reviews.comment,
    })
    .from(reviews)
    .where(inArray(reviews.contract_id, contractIds));
};

export const findAgencyNamesByIds = (
  executor: DbExecutor,
  agencyIds: string[],
) => {
  return executor
    .select({ id: agency_metadata.id, name: agency_metadata.name })
    .from(agency_metadata)
    .where(inArray(agency_metadata.id, agencyIds));
};

export const findClientBillingAccount = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const [account] = await executor
    .select({
      stripeCustomerId: accounts.stripe_customer_id,
      email: accounts.email,
    })
    .from(accounts)
    .where(and(eq(accounts.auth_id, clientId), eq(accounts.role, "CLIENT")))
    .limit(1);
  return account;
};

export const findFreelancerSearchRows = (
  executor: DbExecutor,
  page: { limit: number; offset: number },
) => {
  const { limit, offset } = page;
  return executor
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
};

export const findOnboardedAgencySearchRows = (
  executor: DbExecutor,
  page: { limit: number; offset: number },
) => {
  const { limit, offset } = page;
  return executor
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
    .leftJoin(agency_earning, eq(agency_earning.agency_id, agency_metadata.id))
    .where(eq(agency_metadata.is_onboarded, true))
    .limit(limit)
    .offset(offset);
};

export const findAverageResponseSeconds = async (
  executor: DbExecutor,
  clientId: string,
) => {
  const responseResult = await executor.execute<{
    avg_seconds: number | null;
  }>(sql`
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
  return responseResult.rows;
};
