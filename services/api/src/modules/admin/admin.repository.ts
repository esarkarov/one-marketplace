import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { client_metadata } from "../client/client.schema.js";
import {
  connects,
  connects_purchase_history,
} from "../connects/connects.schema.js";
import {
  contract_milestones,
  contracts,
  earning_history,
} from "../contracts/contracts.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import { payout_history } from "../payouts/payouts.schema.js";
import { proposals } from "../proposals/proposals.schema.js";

export const countAccountsByRole = (
  executor: DbExecutor,
  role: "FREELANCER" | "CLIENT",
) =>
  executor
    .select({ value: count() })
    .from(accounts)
    .where(eq(accounts.role, role));

export const countAgencies = (executor: DbExecutor) =>
  executor.select({ value: count() }).from(agency_metadata);

export const countJobPosts = (executor: DbExecutor) =>
  executor.select({ value: count() }).from(job_posts);

export const countProposals = (executor: DbExecutor) =>
  executor.select({ value: count() }).from(proposals);

export const countContracts = (executor: DbExecutor) =>
  executor.select({ value: count() }).from(contracts);

export const countActiveContracts = (executor: DbExecutor) =>
  executor
    .select({ value: count() })
    .from(contracts)
    .where(eq(contracts.status, "ACTIVE"));

export const sumContractTotalCents = (executor: DbExecutor) =>
  executor.select({ value: sum(contracts.total_amount_cents) }).from(contracts);

export const sumPaidPayoutCents = (executor: DbExecutor) =>
  executor
    .select({ value: sum(payout_history.amount_cents) })
    .from(payout_history)
    .where(eq(payout_history.status, "PAID"));

export const sumCompletedConnectsPurchaseCents = (executor: DbExecutor) =>
  executor
    .select({ value: sum(connects_purchase_history.amount_paid_cents) })
    .from(connects_purchase_history)
    .where(eq(connects_purchase_history.status, "COMPLETED"));

export const listRecentAccounts = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: accounts.id,
      role: accounts.role,
      createdAt: accounts.created_at,
    })
    .from(accounts)
    .orderBy(desc(accounts.created_at))
    .limit(limit);

export const listRecentAgencies = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      createdAt: agency_metadata.created_at,
    })
    .from(agency_metadata)
    .orderBy(desc(agency_metadata.created_at))
    .limit(limit);

export const listRecentJobPosts = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: job_posts.id,
      title: job_posts.title,
      createdAt: job_posts.created_at,
    })
    .from(job_posts)
    .orderBy(desc(job_posts.created_at))
    .limit(limit);

export const listRecentContracts = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: contracts.id,
      title: contracts.title,
      createdAt: contracts.created_at,
    })
    .from(contracts)
    .orderBy(desc(contracts.created_at))
    .limit(limit);

export const listAccountsWithCompany = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      authId: accounts.auth_id,
      role: accounts.role,
      email: accounts.email,
      identityVerified: accounts.identityVerified,
      paymentMethodVerified: accounts.paymentMethodVerified,
      isOnboardingComplete: accounts.isOnboardingComplete,
      createdAt: accounts.created_at,
      companyName: client_metadata.company_name,
    })
    .from(accounts)
    .leftJoin(client_metadata, eq(client_metadata.auth_id, accounts.auth_id))
    .orderBy(desc(accounts.created_at))
    .limit(limit);

export const listAgenciesWithOwner = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      avatarImage: agency_metadata.avatar_image,
      ownerId: agency_metadata.owner_id,
      isOnboarded: agency_metadata.is_onboarded,
      createdAt: agency_metadata.created_at,
      ownerEmail: accounts.email,
      ownerIdentityVerified: accounts.identityVerified,
    })
    .from(agency_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, agency_metadata.owner_id))
    .orderBy(desc(agency_metadata.created_at))
    .limit(limit);

export const listJobPostsPage = (
  executor: DbExecutor,
  { limit, offset }: { limit: number; offset: number },
) =>
  executor
    .select({
      id: job_posts.id,
      title: job_posts.title,
      description: job_posts.description,
      status: job_posts.status,
      totalBudgetCents: job_posts.total_budget_cents,
      expertiseLevel: job_posts.expertise_level,
      expectedDuration: job_posts.expected_duration,
      skills: job_posts.skills,
      milestones: job_posts.milestones,
      screeningQuestions: job_posts.screening_questions,
      attachments: job_posts.attachments,
      clientId: job_posts.client_id,
      companyName: client_metadata.company_name,
      companyWebsite: client_metadata.company_website,
      industry: client_metadata.industry,
      companyDescription: client_metadata.company_description,
      clientEmail: accounts.email,
      createdAt: job_posts.created_at,
      updatedAt: job_posts.updated_at,
      publishedAt: job_posts.published_at,
      hiredAt: job_posts.hired_at,
      proposalCount: sql<number>`(
        SELECT count(*) FROM ${proposals} WHERE ${proposals.job_id} = ${job_posts.id}
      )`.mapWith(Number),
      hireCount: sql<number>`(
        SELECT count(*) FROM ${contracts}
        WHERE ${contracts.job_id} = ${job_posts.id}
          AND ${contracts.status} IN ('ACTIVE', 'COMPLETED')
      )`.mapWith(Number),
    })
    .from(job_posts)
    .leftJoin(client_metadata, eq(client_metadata.auth_id, job_posts.client_id))
    .leftJoin(accounts, eq(accounts.auth_id, job_posts.client_id))
    .orderBy(desc(job_posts.created_at))
    .limit(limit)
    .offset(offset);

export const listProposalsPage = (
  executor: DbExecutor,
  { limit, offset }: { limit: number; offset: number },
) =>
  executor
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      jobTitle: job_posts.title,
      jobBudgetCents: job_posts.total_budget_cents,
      jobStatus: job_posts.status,
      senderId: proposals.sender_id,
      senderType: proposals.sender_type,
      coverLetter: proposals.cover_letter,
      bidAmountCents: proposals.bid_amount_cents,
      duration: proposals.duration,
      screeningAnswers: proposals.screening_answers,
      status: proposals.status,
      isShortlisted: proposals.is_shortlisted,
      createdAt: proposals.created_at,
      updatedAt: proposals.updated_at,
      agencyName: agency_metadata.name,
      agencySpecialty: agency_metadata.specialty,
      agencyWebsite: agency_metadata.website,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(job_posts.id, proposals.job_id))
    .leftJoin(
      agency_metadata,
      and(
        eq(proposals.sender_type, "AGENCY"),
        sql`${proposals.sender_id} = ${agency_metadata.id}::text`,
      ),
    )
    .orderBy(desc(proposals.created_at))
    .limit(limit)
    .offset(offset);

export const listContractsPage = (
  executor: DbExecutor,
  { limit, offset }: { limit: number; offset: number },
) =>
  executor
    .select({
      id: contracts.id,
      title: contracts.title,
      status: contracts.status,
      totalAmountCents: contracts.total_amount_cents,
      jobId: contracts.job_id,
      proposalId: contracts.proposal_id,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      companyName: client_metadata.company_name,
      clientEmail: accounts.email,
      agencyName: agency_metadata.name,
      agencySpecialty: agency_metadata.specialty,
      agencyWebsite: agency_metadata.website,
      createdAt: contracts.created_at,
      updatedAt: contracts.updated_at,
      startedAt: contracts.started_at,
      completedAt: contracts.completed_at,
    })
    .from(contracts)
    .leftJoin(client_metadata, eq(client_metadata.auth_id, contracts.client_id))
    .leftJoin(accounts, eq(accounts.auth_id, contracts.client_id))
    .leftJoin(agency_metadata, eq(agency_metadata.id, contracts.agency_id))
    .orderBy(desc(contracts.created_at))
    .limit(limit)
    .offset(offset);

export const listMilestonesForContracts = (
  executor: DbExecutor,
  contractIds: string[],
) =>
  executor
    .select({
      id: contract_milestones.id,
      contractId: contract_milestones.contract_id,
      title: contract_milestones.title,
      amountCents: contract_milestones.amount_cents,
      dueDate: contract_milestones.due_date,
      position: contract_milestones.position,
      status: contract_milestones.status,
      fundedAt: contract_milestones.funded_at,
      submissionMessage: contract_milestones.submission_message,
      submissionDeliveryLink: contract_milestones.submission_delivery_link,
      completedAt: contract_milestones.completed_at,
    })
    .from(contract_milestones)
    .where(inArray(contract_milestones.contract_id, contractIds))
    .orderBy(contract_milestones.position);

export const listFundedMilestones = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: contract_milestones.id,
      contractId: contract_milestones.contract_id,
      title: contract_milestones.title,
      amountCents: contract_milestones.amount_cents,
      createdAt: contract_milestones.funded_at,
    })
    .from(contract_milestones)
    .where(sql`${contract_milestones.funded_at} IS NOT NULL`)
    .orderBy(desc(contract_milestones.funded_at))
    .limit(limit);

export const listRecentEarnings = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: earning_history.id,
      contractId: earning_history.contract_id,
      description: earning_history.description,
      amountCents: earning_history.amount_cents,
      freelancerId: earning_history.freelancer_id,
      agencyId: earning_history.agency_id,
      createdAt: earning_history.created_at,
    })
    .from(earning_history)
    .orderBy(desc(earning_history.created_at))
    .limit(limit);

export const listPaidPayouts = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: payout_history.id,
      amountCents: payout_history.amount_cents,
      freelancerId: payout_history.freelancer_id,
      agencyId: payout_history.agency_id,
      paidAt: payout_history.paid_at,
      createdAt: payout_history.created_at,
    })
    .from(payout_history)
    .where(eq(payout_history.status, "PAID"))
    .orderBy(
      desc(
        sql`coalesce(${payout_history.paid_at}, ${payout_history.created_at})`,
      ),
    )
    .limit(limit);

export const listConnectsPurchases = (executor: DbExecutor, limit: number) =>
  executor
    .select({
      id: connects_purchase_history.id,
      purchasedConnects: connects_purchase_history.purchased_connects,
      amountPaidCents: connects_purchase_history.amount_paid_cents,
      status: connects_purchase_history.status,
      freelancerId: connects.freelancer_id,
      agencyId: connects.agency_id,
      createdAt: connects_purchase_history.created_at,
    })
    .from(connects_purchase_history)
    .innerJoin(connects, eq(connects.id, connects_purchase_history.connects_id))
    .orderBy(desc(connects_purchase_history.created_at))
    .limit(limit);

export const listAgencyNamesByIds = (
  executor: DbExecutor,
  agencyIds: string[],
) =>
  executor
    .select({ id: agency_metadata.id, name: agency_metadata.name })
    .from(agency_metadata)
    .where(inArray(agency_metadata.id, agencyIds));

export const pingDatabase = (executor: DbExecutor) =>
  executor.execute(sql`SELECT 1`);
