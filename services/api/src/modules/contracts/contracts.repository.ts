import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import {
  accounts,
  client_metadata,
  contract_milestones,
  contracts,
  conversation_participants,
  conversations,
  job_posts,
  messages,
} from "../../database/schema.js";

export const insertMessages = (
  executor: DbExecutor,
  values: (typeof messages.$inferInsert)[],
) =>
  executor
    .insert(messages)
    .values(values)
    .returning({ id: messages.id, createdAt: messages.created_at });

export const setConversationLastMessage = (
  executor: DbExecutor,
  conversationId: string,
  message: { id: string; createdAt: Date },
  updatedAt: Date,
) =>
  executor
    .update(conversations)
    .set({
      last_message_id: message.id,
      last_message_at: message.createdAt,
      updated_at: updatedAt,
    })
    .where(eq(conversations.id, conversationId));

export const incrementUnreadCount = (
  executor: DbExecutor,
  conversationId: string,
  recipient: SQL,
  amount: number,
) =>
  executor
    .update(conversation_participants)
    .set({
      unread_count: sql`${conversation_participants.unread_count} + ${amount}`,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, conversationId),
        recipient,
      ),
    );

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

export const listContractRows = (
  executor: DbExecutor,
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId?: string | null,
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
      role === "client"
        ? eq(contracts.client_id, userId)
        : role === "agency"
          ? eq(contracts.agency_id, agencyId!)
          : eq(contracts.freelancer_id, userId),
    )
    .orderBy(desc(contracts.created_at), asc(contract_milestones.position));
