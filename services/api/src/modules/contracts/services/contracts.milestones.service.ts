import { logger } from "../../../config/logger.js";
import { db } from "../../../database/client.js";
import { isUniqueViolation } from "../../../database/pg-errors.js";
import { appendJobMilestone } from "../../jobs/jobs.public.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { splitFee } from "../../../shared/money/money.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import {
  appendConversationMessages,
  emitConversationUpdate,
} from "../../messaging/messaging.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import {
  findContractForNewMilestone,
  findMilestoneForReview,
  findMilestoneForSubmission,
} from "../contracts.repository.js";
import {
  addAgencyEarning,
  addClientSpent,
  addFreelancerEarning,
  addToContractTotal,
  insertEarningHistory,
  insertPendingMilestone,
  lockContractStatusForUpdate,
  markMilestoneReviewedIfAwaitingReview,
  markMilestoneSubmittedIfActiveAndFunded,
  readMilestoneAppendState,
} from "../contracts.state.repository.js";

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
    const [submitted] = await markMilestoneSubmittedIfActiveAndFunded(
      transaction,
      {
        milestoneId: milestone.milestoneId,
        submissionMessage,
        submissionDeliveryLink: submissionDeliveryLink ?? null,
        now,
      },
    );
    if (!submitted) throw milestoneNotSubmittable();

    const [message] = await appendConversationMessages(transaction, {
      conversationId: milestone.conversationId,
      messages: [
        {
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
      ],
      updatedAt: now,
      unread: { account: milestone.clientId },
    });
    if (!message)
      throw new ApiError(500, "Milestone submission could not be sent.");
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
  const [milestone] = await findMilestoneForReview(db, {
    contractId,
    milestoneId,
    clientId,
  });

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
      const [transitioned] = await markMilestoneReviewedIfAwaitingReview(
        transaction,
        { milestoneId: milestone.milestoneId, approved, now },
      );
      if (!transitioned) throw notAwaitingReview();

      if (approved) {
        if (milestone.agencyId) {
          await addAgencyEarning(
            transaction,
            milestone.agencyId,
            netCents,
            now,
          );
        } else {
          await addFreelancerEarning(
            transaction,
            freelancerAccountId,
            netCents,
            now,
          );
        }
        await addClientSpent(transaction, clientId, grossCents, now);
        await insertEarningHistory(transaction, {
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
              sender_id: clientId,
              message_type: "USER" as const,
              body: feedback!,
              event_type: null,
              event_payload: null,
              created_at: new Date(now.getTime() + 1),
            },
          ];
      const insertedMessages = await appendConversationMessages(transaction, {
        conversationId: milestone.conversationId,
        messages: reviewMessages,
        updatedAt: now,
        unread: { account: freelancerAccountId, agency: milestone.agencyId },
      });
      if (insertedMessages.length === 0)
        throw new ApiError(500, "Milestone review could not be sent.");
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
    const [locked] = await lockContractStatusForUpdate(
      transaction,
      contract.id,
    );
    if (!locked || locked.status !== "ACTIVE") throw milestoneAddNotAllowed();

    const [state] = await readMilestoneAppendState(transaction, contract.id);
    if (!state || state.incomplete > 0) throw milestoneAddNotAllowed();

    const [milestone] = await insertPendingMilestone(transaction, {
      contractId: contract.id,
      title: input.title,
      amountCents: input.amountCents,
      dueDate: input.dueDate,
      position: state.nextPosition,
    });
    if (!milestone) throw new ApiError(500, "Milestone could not be added.");

    await appendJobMilestone(
      transaction,
      contract.jobId,
      {
        id: milestone.id,
        title: input.title,
        budgetCents: input.amountCents,
        dueDate: input.dueDate,
      },
      now,
    );
    await addToContractTotal(transaction, contract.id, input.amountCents, now);

    if (!contract.conversationId) {
      return { milestoneId: milestone.id, conversationId: null };
    }
    const [message] = await appendConversationMessages(transaction, {
      conversationId: contract.conversationId,
      messages: [
        {
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
      ],
      updatedAt: now,
      unread: { account: freelancerAccountId, agency: contract.agencyId },
    });
    if (!message) throw new ApiError(500, "Milestone event could not be sent.");
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
