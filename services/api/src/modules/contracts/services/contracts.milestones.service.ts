import { and, eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "../../../config/logger.js";
import { db } from "../../../database/client.js";
import { isUniqueViolation } from "../../../database/pg-errors.js";
import {
  agency_earning,
  client_spents,
  contract_milestones,
  contracts,
  earning_history,
  freelancer_earning,
} from "../contracts.schema.js";
import {
  conversation_participants,
  conversations,
} from "../../messaging/messaging.schema.js";
import { job_posts } from "../../jobs/jobs.schema.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { splitFee } from "../../../shared/money/money.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import { emitConversationUpdate } from "../../messaging/messaging.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import {
  findContractForNewMilestone,
  findMilestoneForSubmission,
  incrementUnreadCount,
  insertMessages,
  setConversationLastMessage,
} from "../contracts.repository.js";
import { participantMatch } from "./contracts.helpers.js";

const milestoneAddNotAllowed = () =>
  new ApiError(
    409,
    "New milestones can be added only after all current milestones are completed.",
    "MILESTONE_ADD_NOT_ALLOWED",
  );

const milestoneNotSubmittable = () =>
  new ApiError(
    409,
    "Only the active funded milestone can be submitted.",
    "MILESTONE_NOT_SUBMITTABLE",
  );

export const submitContractMilestone = async (
  contractId: string,
  milestoneId: string,
  freelancerId: string,
  submissionMessage: string,
  submissionDeliveryLink?: string,
  agencyId?: string | null,
) => {
  const [milestone] = await findMilestoneForSubmission(
    db,
    contractId,
    milestoneId,
    freelancerId,
    agencyId,
  );

  if (!milestone) throw new ApiError(404, "Contract milestone not found.");
  if (milestone.contractStatus !== "ACTIVE") throw milestoneNotSubmittable();

  const now = new Date();
  await db.transaction(async (transaction) => {
    const [submitted] = await transaction
      .update(contract_milestones)
      .set({
        submission_message: submissionMessage,
        submission_delivery_link: submissionDeliveryLink ?? null,
        payment_requested_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(contract_milestones.id, milestone.milestoneId),
          eq(contract_milestones.status, "ACTIVE"),
          isNotNull(contract_milestones.funded_at),
        ),
      )
      .returning({ id: contract_milestones.id });
    if (!submitted) throw milestoneNotSubmittable();

    const [message] = await insertMessages(transaction, [
      {
        conversation_id: milestone.conversationId,
        sender_id: freelancerId,
        message_type: "SYSTEM_EVENT",
        body: `Work submitted for “${milestone.milestoneTitle}”.`,
        event_type: "MILESTONE_SUBMITTED",
        event_payload: {
          contractId: milestone.contractId,
          milestoneId: milestone.milestoneId,
          contractTitle: milestone.contractTitle,
          milestoneTitle: milestone.milestoneTitle,
          amountCents: milestone.milestoneAmountCents,
          submissionMessage,
          submissionDeliveryLink: submissionDeliveryLink ?? null,
        },
      },
    ]);
    if (!message)
      throw new ApiError(500, "Milestone submission could not be sent.");

    await setConversationLastMessage(
      transaction,
      milestone.conversationId,
      message,
      now,
    );
    await incrementUnreadCount(
      transaction,
      milestone.conversationId,
      eq(conversation_participants.account_id, milestone.clientId),
      1,
    );
  });

  return milestone;
};

const notAwaitingReview = () =>
  new ApiError(409, "This milestone is not awaiting review.");

const EARNING_MILESTONE_UNIQUE = "earning_history_milestone_id_unique";

const isEarningMilestoneConflict = (error: unknown): boolean =>
  isUniqueViolation(error, EARNING_MILESTONE_UNIQUE);

export const reviewContractMilestone = async (
  contractId: string,
  milestoneId: string,
  clientId: string,
  action: "APPROVE" | "REQUEST_CHANGES",
  feedback?: string,
) => {
  const [milestone] = await db
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
        eq(contracts.id, contractId),
        eq(contracts.client_id, clientId),
        eq(contracts.status, "ACTIVE"),
        eq(contract_milestones.id, milestoneId),
      ),
    )
    .limit(1);

  if (!milestone) throw new ApiError(404, "Contract milestone not found.");
  if (milestone.milestoneStatus !== "ACTIVE" || !milestone.paymentRequestedAt) {
    throw notAwaitingReview();
  }

  const freelancerAccountId =
    milestone.freelancerId ??
    (milestone.agencyId ? await getAgencyOwnerId(milestone.agencyId) : null);
  if (!freelancerAccountId) {
    throw new ApiError(500, "Contract owner could not be resolved.");
  }

  const approved = action === "APPROVE";
  const now = new Date();
  const grossCents = milestone.milestoneAmountCents;
  const { feeCents, netCents } = splitFee(grossCents);

  await db
    .transaction(async (transaction) => {
      const [transitioned] = await transaction
        .update(contract_milestones)
        .set(
          approved
            ? { status: "COMPLETED", completed_at: now, updated_at: now }
            : { payment_requested_at: null, updated_at: now },
        )
        .where(
          and(
            eq(contract_milestones.id, milestone.milestoneId),
            eq(contract_milestones.status, "ACTIVE"),
            isNotNull(contract_milestones.payment_requested_at),
          ),
        )
        .returning({ id: contract_milestones.id });
      if (!transitioned) throw notAwaitingReview();

      if (approved) {
        if (milestone.agencyId) {
          await transaction
            .insert(agency_earning)
            .values({
              agency_id: milestone.agencyId,
              total_earning_cents: netCents,
            })
            .onConflictDoUpdate({
              target: agency_earning.agency_id,
              set: {
                total_earning_cents: sql`${agency_earning.total_earning_cents} + ${netCents}`,
                updated_at: now,
              },
            });
        } else {
          await transaction
            .insert(freelancer_earning)
            .values({
              freelancer_id: freelancerAccountId,
              total_earning_cents: netCents,
            })
            .onConflictDoUpdate({
              target: freelancer_earning.freelancer_id,
              set: {
                total_earning_cents: sql`${freelancer_earning.total_earning_cents} + ${netCents}`,
                updated_at: now,
              },
            });
        }
        await transaction
          .insert(client_spents)
          .values({
            client_id: clientId,
            total_spent_cents: grossCents,
          })
          .onConflictDoUpdate({
            target: client_spents.client_id,
            set: {
              total_spent_cents: sql`${client_spents.total_spent_cents} + ${grossCents}`,
              updated_at: now,
            },
          });
        await transaction.insert(earning_history).values({
          freelancer_id: milestone.agencyId ? null : freelancerAccountId,
          agency_id: milestone.agencyId ?? null,
          contract_id: milestone.contractId,
          milestone_id: milestone.milestoneId,
          amount_cents: grossCents,
          platform_fee_cents: feeCents,
          description: `Milestone payment for "${milestone.milestoneTitle}"`,
        });
      }

      const reviewMessages = approved
        ? [
            {
              conversation_id: milestone.conversationId,
              sender_id: clientId,
              message_type: "SYSTEM_EVENT" as const,
              body: `The client accepted the work for “${milestone.milestoneTitle}”.`,
              event_type: "MILESTONE_APPROVED",
              event_payload: {
                contractId: milestone.contractId,
                milestoneId: milestone.milestoneId,
                contractTitle: milestone.contractTitle,
                milestoneTitle: milestone.milestoneTitle,
                amountCents: milestone.milestoneAmountCents,
              },
              created_at: now,
            },
          ]
        : [
            {
              conversation_id: milestone.conversationId,
              sender_id: clientId,
              message_type: "SYSTEM_EVENT" as const,
              body: `The client requested modifications for “${milestone.milestoneTitle}”.`,
              event_type: "MILESTONE_CHANGES_REQUESTED",
              event_payload: {
                contractId: milestone.contractId,
                milestoneId: milestone.milestoneId,
                contractTitle: milestone.contractTitle,
                milestoneTitle: milestone.milestoneTitle,
                amountCents: milestone.milestoneAmountCents,
              },
              created_at: now,
            },
            {
              conversation_id: milestone.conversationId,
              sender_id: clientId,
              message_type: "USER" as const,
              body: feedback!,
              event_type: null,
              event_payload: null,
              created_at: new Date(now.getTime() + 1),
            },
          ];
      const insertedMessages = await insertMessages(
        transaction,
        reviewMessages,
      );
      const message = insertedMessages.at(-1);
      if (!message)
        throw new ApiError(500, "Milestone review could not be sent.");

      await setConversationLastMessage(
        transaction,
        milestone.conversationId,
        message,
        now,
      );
      await incrementUnreadCount(
        transaction,
        milestone.conversationId,
        participantMatch(freelancerAccountId, milestone.agencyId),
        insertedMessages.length,
      );
    })
    .catch(async (error: unknown) => {
      if (!isEarningMilestoneConflict(error)) throw error;
      try {
        await logger.warn({
          message: "Milestone review conflicted with an existing earning",
          eventName: "contracts.milestone.review_conflict",
          attributes: {
            "contract.id": milestone.contractId,
            "milestone.id": milestone.milestoneId,
          },
        });
      } catch {}
      throw notAwaitingReview();
    });

  return { ...milestone, approved, freelancerId: freelancerAccountId };
};

export const addContractMilestone = async (
  contractId: string,
  clientId: string,
  input: { title: string; amountCents: number; dueDate: string },
) => {
  const [contract] = await findContractForNewMilestone(
    db,
    contractId,
    clientId,
  );

  if (!contract) throw new ApiError(404, "Contract not found.");

  const freelancerAccountId =
    contract.freelancerId ??
    (contract.agencyId ? await getAgencyOwnerId(contract.agencyId) : null);
  if (!freelancerAccountId) {
    throw new ApiError(500, "Contract owner could not be resolved.");
  }

  const now = new Date();
  const result = await db.transaction(async (transaction) => {
    const [locked] = await transaction
      .select({ status: contracts.status })
      .from(contracts)
      .where(eq(contracts.id, contract.id))
      .for("update");
    if (!locked || locked.status !== "ACTIVE") throw milestoneAddNotAllowed();

    const [state] = await transaction
      .select({
        incomplete: sql<number>`count(*) filter (where ${contract_milestones.status} <> 'COMPLETED')::int`,
        nextPosition: sql<number>`coalesce(max(${contract_milestones.position}), -1)::int + 1`,
      })
      .from(contract_milestones)
      .where(eq(contract_milestones.contract_id, contract.id));
    if (!state || state.incomplete > 0) throw milestoneAddNotAllowed();

    const [milestone] = await transaction
      .insert(contract_milestones)
      .values({
        contract_id: contract.id,
        title: input.title,
        amount_cents: input.amountCents,
        due_date: input.dueDate,
        position: state.nextPosition,
        status: "PENDING",
      })
      .returning({ id: contract_milestones.id });
    if (!milestone) throw new ApiError(500, "Milestone could not be added.");

    const [currentJob] = await transaction
      .select({ milestones: job_posts.milestones })
      .from(job_posts)
      .where(eq(job_posts.id, contract.jobId));
    const updatedJobMilestones = [
      ...(currentJob?.milestones ?? contract.jobMilestones),
      {
        id: milestone.id,
        title: input.title,
        budgetCents: input.amountCents,
        dueDate: input.dueDate,
      },
    ];
    await transaction
      .update(job_posts)
      .set({
        milestones: updatedJobMilestones,
        total_budget_cents: sql`${job_posts.total_budget_cents} + ${input.amountCents}`,
        updated_at: now,
      })
      .where(eq(job_posts.id, contract.jobId));
    await transaction
      .update(contracts)
      .set({
        total_amount_cents: sql`${contracts.total_amount_cents} + ${input.amountCents}`,
        updated_at: now,
      })
      .where(eq(contracts.id, contract.id));

    if (!contract.conversationId) {
      return { milestoneId: milestone.id, conversationId: null };
    }
    const [message] = await insertMessages(transaction, [
      {
        conversation_id: contract.conversationId,
        sender_id: clientId,
        message_type: "SYSTEM_EVENT",
        body: `A new milestone was added: “${input.title}”.`,
        event_type: "MILESTONE_ADDED",
        event_payload: {
          contractId: contract.id,
          milestoneId: milestone.id,
          milestoneTitle: input.title,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
        },
      },
    ]);
    if (!message) throw new ApiError(500, "Milestone event could not be sent.");
    await setConversationLastMessage(
      transaction,
      contract.conversationId,
      message,
      now,
    );
    await incrementUnreadCount(
      transaction,
      contract.conversationId,
      participantMatch(freelancerAccountId, contract.agencyId),
      1,
    );
    return {
      milestoneId: milestone.id,
      conversationId: contract.conversationId,
    };
  });

  await sendNotification(
    contract.agencyId
      ? {
          agencyId: contract.agencyId,
          type: "MILESTONE_ADDED",
          title: "New contract milestone",
          message: `The client added “${input.title}” to your contract.`,
          link: `/contracts?contractId=${contract.id}`,
          metadata: {
            contractId: contract.id,
            milestoneId: result.milestoneId,
          },
        }
      : {
          recipientId: freelancerAccountId,
          type: "MILESTONE_ADDED",
          title: "New contract milestone",
          message: `The client added “${input.title}” to your contract.`,
          link: `/contracts?contractId=${contract.id}`,
          metadata: {
            contractId: contract.id,
            milestoneId: result.milestoneId,
          },
        },
  );
  if (result.conversationId)
    await emitConversationUpdate(result.conversationId);

  return {
    id: result.milestoneId,
    title: input.title,
    amountCents: input.amountCents,
    dueDate: input.dueDate,
    status: "PENDING" as const,
  };
};
