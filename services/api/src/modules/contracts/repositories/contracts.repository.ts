import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../database/database.types.js";
import { accounts } from "../../auth/models/auth.model.js";
import { client_metadata } from "../../client/models/client.model.js";
import { contract_milestones, contracts } from "../models/contracts.model.js";
import { conversations } from "../../messaging/models/messaging.model.js";
import { job_posts } from "../../jobs/models/jobs.model.js";
import { proposals } from "../../proposals/models/proposals.model.js";
import { agency_metadata } from "../../agency/models/agency.model.js";

export const findMilestoneForFunding = (
  executor: DbExecutor,
  clientId: string,
  contractId: string,
  milestoneId: string,
) =>
  executor
    .select({
      contractId: contracts.id,
      contractTitle: contracts.title,
      contractStatus: contracts.status,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      milestonePosition: contract_milestones.position,
      milestoneStatus: contract_milestones.status,
      fundedAt: contract_milestones.funded_at,
      customerId: accounts.stripe_customer_id,
      incompletePrevious: sql<number>`(
        select count(*)::int from contract_milestones previous
        where previous.contract_id = ${contracts.id}
          and previous.position < ${contract_milestones.position}
          and previous.status <> 'COMPLETED'
      )`,
      activeMilestones: sql<number>`(
        select count(*)::int from contract_milestones active
        where active.contract_id = ${contracts.id}
          and active.status = 'ACTIVE'
      )`,
    })
    .from(contracts)
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .innerJoin(accounts, eq(accounts.auth_id, contracts.client_id))
    .where(
      and(
        eq(contracts.id, contractId),
        eq(contracts.client_id, clientId),
        eq(contract_milestones.id, milestoneId),
      ),
    )
    .limit(1);

export const findContractForReview = (
  executor: DbExecutor,
  contractId: string,
  reviewerId: string,
  role: "client" | "freelancer",
  agencyId?: string | null,
) =>
  executor
    .select({
      id: contracts.id,
      title: contracts.title,
      status: contracts.status,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      conversationId: conversations.id,
      // An agency counts as one entity: any teammate’s review blocks a second one.
      existingReview:
        role !== "client" && agencyId
          ? sql<number>`(
              select count(*)::int from reviews existing_review
              where existing_review.contract_id = ${contracts.id}
                and existing_review.agency_id = ${agencyId}
                and existing_review.reviewee_id = ${contracts.client_id}
            )`
          : sql<number>`(
              select count(*)::int from reviews existing_review
              where existing_review.contract_id = ${contracts.id}
                and existing_review.reviewer_id = ${reviewerId}
            )`,
    })
    .from(contracts)
    .leftJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .where(
      and(
        eq(contracts.id, contractId),
        role === "client"
          ? eq(contracts.client_id, reviewerId)
          : agencyId
            ? eq(contracts.agency_id, agencyId)
            : eq(contracts.freelancer_id, reviewerId),
      ),
    )
    .limit(1);

export const findMilestoneForSubmission = (
  executor: DbExecutor,
  contractId: string,
  milestoneId: string,
  freelancerId: string,
  agencyId?: string | null,
) =>
  executor
    .select({
      contractId: contracts.id,
      contractTitle: contracts.title,
      contractStatus: contracts.status,
      clientId: contracts.client_id,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      conversationId: conversations.id,
    })
    .from(contracts)
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .where(
      and(
        eq(contracts.id, contractId),
        agencyId
          ? eq(contracts.agency_id, agencyId)
          : eq(contracts.freelancer_id, freelancerId),
        eq(contract_milestones.id, milestoneId),
      ),
    )
    .limit(1);

export const findContractForNewMilestone = (
  executor: DbExecutor,
  contractId: string,
  clientId: string,
) =>
  executor
    .select({
      id: contracts.id,
      jobId: contracts.job_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      status: contracts.status,
      jobMilestones: job_posts.milestones,
      conversationId: conversations.id,
    })
    .from(contracts)
    .innerJoin(job_posts, eq(job_posts.id, contracts.job_id))
    .leftJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .where(and(eq(contracts.id, contractId), eq(contracts.client_id, clientId)))
    .limit(1);

const accountContractFilter = (
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId?: string | null,
) =>
  role === "client"
    ? eq(contracts.client_id, userId)
    : role === "agency"
      ? eq(contracts.agency_id, agencyId!)
      : eq(contracts.freelancer_id, userId);

export const listAccountContractIds = (
  executor: DbExecutor,
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId: string | null | undefined,
  page: { limit: number; offset: number },
) =>
  executor
    .select({ id: contracts.id })
    .from(contracts)
    .where(accountContractFilter(userId, role, agencyId))
    .orderBy(desc(contracts.created_at), desc(contracts.id))
    .limit(page.limit)
    .offset(page.offset);

export const listContractRows = (
  executor: DbExecutor,
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId: string | null | undefined,
  contractIds: string[],
) =>
  executor
    .select({
      id: contracts.id,
      proposalId: contracts.proposal_id,
      jobId: contracts.job_id,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      title: contracts.title,
      description: job_posts.description,
      totalAmountCents: contracts.total_amount_cents,
      status: contracts.status,
      startedAt: contracts.started_at,
      completedAt: contracts.completed_at,
      createdAt: contracts.created_at,
      conversationId: conversations.id,
      clientCompanyName: client_metadata.company_name,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      milestoneDueDate: contract_milestones.due_date,
      milestonePosition: contract_milestones.position,
      milestoneStatus: contract_milestones.status,
      milestoneFundedAt: contract_milestones.funded_at,
      milestonePaymentRequestedAt: contract_milestones.payment_requested_at,
      milestoneSubmissionMessage: contract_milestones.submission_message,
      milestoneSubmissionDeliveryLink:
        contract_milestones.submission_delivery_link,
      milestoneCompletedAt: contract_milestones.completed_at,
      reviewedByCurrentUser:
        role === "agency" && agencyId
          ? sql<boolean>`exists(
              select 1 from reviews account_review
              where account_review.contract_id = ${contracts.id}
                and account_review.agency_id = ${agencyId}
                and account_review.reviewee_id = ${contracts.client_id}
            )`
          : sql<boolean>`exists(
              select 1 from reviews account_review
              where account_review.contract_id = ${contracts.id}
                and account_review.reviewer_id = ${userId}
            )`,
    })
    .from(contracts)
    .innerJoin(job_posts, eq(contracts.job_id, job_posts.id))
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .leftJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .leftJoin(client_metadata, eq(client_metadata.auth_id, contracts.client_id))
    .where(
      and(
        accountContractFilter(userId, role, agencyId),
        inArray(contracts.id, contractIds),
      ),
    )
    .orderBy(
      desc(contracts.created_at),
      desc(contracts.id),
      asc(contract_milestones.position),
      asc(contract_milestones.id),
    );

export const listPublicAccountIds = (executor: DbExecutor, authIds: string[]) =>
  executor
    .select({ authId: accounts.auth_id, id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.auth_id, authIds));

export const findContractIdByProposal = (
  executor: DbExecutor,
  proposalId: string,
) =>
  executor
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.proposal_id, proposalId))
    .limit(1);

export const findMilestoneIdByCheckoutSession = (
  executor: DbExecutor,
  checkoutSessionId: string,
) =>
  executor
    .select({ id: contract_milestones.id })
    .from(contract_milestones)
    .where(
      eq(contract_milestones.stripe_checkout_session_id, checkoutSessionId),
    )
    .limit(1);

export const findMilestoneFundingState = (
  executor: DbExecutor,
  input: { contractId: string; milestoneId: string },
) =>
  executor
    .select({ fundedAt: contract_milestones.funded_at })
    .from(contract_milestones)
    .where(
      and(
        eq(contract_milestones.id, input.milestoneId),
        eq(contract_milestones.contract_id, input.contractId),
      ),
    )
    .limit(1);

export const findProposalOfferForCheckout = (
  executor: DbExecutor,
  proposalId: string,
  clientId: string,
) =>
  executor
    .select({
      proposal: proposals,
      job: job_posts,
      account: accounts,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .innerJoin(accounts, eq(accounts.auth_id, job_posts.client_id))
    .where(and(eq(proposals.id, proposalId), eq(job_posts.client_id, clientId)))
    .limit(1);

export const findPendingMilestoneForPaymentFunding = (
  executor: DbExecutor,
  input: { contractId: string; clientId: string; milestoneId: string },
) =>
  executor
    .select({
      contractId: contracts.id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      conversationId: conversations.id,
      customerId: accounts.stripe_customer_id,
    })
    .from(contracts)
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .innerJoin(accounts, eq(accounts.auth_id, contracts.client_id))
    .where(
      and(
        eq(contracts.id, input.contractId),
        eq(contracts.client_id, input.clientId),
        eq(contracts.status, "ACTIVE"),
        eq(contract_milestones.id, input.milestoneId),
        eq(contract_milestones.status, "PENDING"),
      ),
    )
    .limit(1);

export const findFundedContractOffer = (
  executor: DbExecutor,
  input: {
    contractId: string;
    freelancerId: string;
    agencyId?: string | null;
  },
) =>
  executor
    .select({
      id: contracts.id,
      proposalId: contracts.proposal_id,
      title: contracts.title,
      status: contracts.status,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      identityVerified: accounts.identityVerified,
      conversationId: conversations.id,
      milestoneId: contract_milestones.id,
    })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.auth_id, input.freelancerId))
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .innerJoin(
      contract_milestones,
      and(
        eq(contract_milestones.contract_id, contracts.id),
        eq(contract_milestones.position, 0),
        isNotNull(contract_milestones.funded_at),
      ),
    )
    .where(
      and(
        eq(contracts.id, input.contractId),
        input.agencyId
          ? eq(contracts.agency_id, input.agencyId)
          : eq(contracts.freelancer_id, input.freelancerId),
      ),
    )
    .limit(1);

export const findContractForCancellation = (
  executor: DbExecutor,
  input: {
    contractId: string;
    actor:
      | { kind: "client"; clientId: string }
      | { kind: "talent"; freelancerId: string; agencyId?: string | null };
  },
) =>
  executor
    .select({
      id: contracts.id,
      jobId: contracts.job_id,
      title: contracts.title,
      status: contracts.status,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      conversationId: conversations.id,
      checkoutSessionId: contract_milestones.stripe_checkout_session_id,
      paymentIntentId: contract_milestones.stripe_payment_intent_id,
    })
    .from(contracts)
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .innerJoin(
      contract_milestones,
      and(
        eq(contract_milestones.contract_id, contracts.id),
        eq(contract_milestones.position, 0),
        isNotNull(contract_milestones.funded_at),
      ),
    )
    .where(
      and(
        eq(contracts.id, input.contractId),
        input.actor.kind === "client"
          ? eq(contracts.client_id, input.actor.clientId)
          : input.actor.agencyId
            ? eq(contracts.agency_id, input.actor.agencyId)
            : eq(contracts.freelancer_id, input.actor.freelancerId),
      ),
    )
    .limit(1);

export const findProposalOfferForContractCreation = (
  executor: DbExecutor,
  proposalId: string,
  clientId: string,
) =>
  executor
    .select({
      proposal: proposals,
      job: job_posts,
      stripeCustomerId: accounts.stripe_customer_id,
      conversationId: conversations.id,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .innerJoin(accounts, eq(accounts.auth_id, job_posts.client_id))
    .innerJoin(conversations, eq(conversations.proposal_id, proposals.id))
    .where(and(eq(proposals.id, proposalId), eq(job_posts.client_id, clientId)))
    .limit(1);

export const findMilestoneForReview = (
  executor: DbExecutor,
  input: { contractId: string; milestoneId: string; clientId: string },
) =>
  executor
    .select({
      contractId: contracts.id,
      contractTitle: contracts.title,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      milestoneStatus: contract_milestones.status,
      paymentRequestedAt: contract_milestones.payment_requested_at,
      conversationId: conversations.id,
    })
    .from(contracts)
    .innerJoin(
      contract_milestones,
      eq(contract_milestones.contract_id, contracts.id),
    )
    .innerJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .where(
      and(
        eq(contracts.id, input.contractId),
        eq(contracts.client_id, input.clientId),
        eq(contracts.status, "ACTIVE"),
        eq(contract_milestones.id, input.milestoneId),
      ),
    )
    .limit(1);

export const listAgencySummariesByIds = (
  executor: DbExecutor,
  agencyIds: string[],
) =>
  executor
    .select({
      id: agency_metadata.id,
      name: agency_metadata.name,
      avatar: agency_metadata.avatar_image,
    })
    .from(agency_metadata)
    .where(inArray(agency_metadata.id, agencyIds));
