import type Stripe from "stripe";
import { db } from "../../../database/client.js";
import { isUniqueViolation } from "../../../database/pg-errors.js";
import { markPaymentMethodVerified } from "../../auth/auth.public.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import {
  appendConversationMessages,
  emitConversationUpdate,
} from "../../messaging/messaging.public.js";
import { getJSSContribution } from "../../freelancer/freelancer.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import {
  findContractForReview,
  findFundedContractOffer,
  findProposalOfferForContractCreation,
} from "../contracts.repository.js";
import {
  countIncompleteMilestones,
  insertContractIfProposalUnused,
  insertContractMilestones,
  insertReview,
  lockContractStatusForUpdate,
  markContractActiveIfPending,
  markContractCompletedIfActive,
  markMilestoneActiveIfFundedAndPending,
  recordAgencyJobCompleted,
  recordAgencyJobStarted,
  recordAgencyReviewStats,
  recordClientContractCompleted,
  recordClientContractStarted,
  recordClientReviewStats,
  recordFreelancerJobCompleted,
  recordFreelancerJobStarted,
  recordFreelancerReviewStats,
} from "../contracts.state.repository.js";

const REVIEW_CONTRACT_REVIEWER_UNIQUE = "reviews_contract_reviewer_unique";

const reviewAlreadySubmitted = () =>
  new ApiError(
    409,
    "You have already reviewed this contract.",
    "REVIEW_ALREADY_SUBMITTED",
  );

const contractAlreadyFinished = () =>
  new ApiError(
    409,
    "Contract was already finished.",
    "CONTRACT_ALREADY_FINISHED",
  );

const contractHasIncompleteMilestones = () =>
  new ApiError(
    409,
    "Complete every milestone before finishing the contract.",
    "CONTRACT_HAS_INCOMPLETE_MILESTONES",
  );

export const finishContractWithReview = async (
  contractId: string,
  reviewerId: string,
  role: "client" | "freelancer",
  rating: number,
  comment: string,
  agencyId?: string | null,
) => {
  const [contract] = await findContractForReview(
    db,
    contractId,
    reviewerId,
    role,
    agencyId,
  );

  if (!contract) throw new ApiError(404, "Contract not found.");
  if (contract.status === "PENDING") {
    throw new ApiError(409, "This contract has not started yet.");
  }
  if (contract.existingReview > 0) throw reviewAlreadySubmitted();

  const freelancerAccountId =
    contract.freelancerId ??
    (contract.agencyId ? await getAgencyOwnerId(contract.agencyId) : null);
  if (!freelancerAccountId) {
    throw new ApiError(500, "Contract owner could not be resolved.");
  }

  const revieweeId =
    role === "client" ? freelancerAccountId : contract.clientId;
  const now = new Date();
  const newlyCompleted = contract.status === "ACTIVE";

  await db
    .transaction(async (transaction) => {
      const [locked] = await lockContractStatusForUpdate(
        transaction,
        contract.id,
      );
      if (!locked) throw new ApiError(404, "Contract not found.");
      if (newlyCompleted && locked.status !== "ACTIVE") {
        throw contractAlreadyFinished();
      }

      const [pending] = await countIncompleteMilestones(
        transaction,
        contract.id,
      );
      if ((pending?.count ?? 0) > 0) throw contractHasIncompleteMilestones();

      await insertReview(transaction, {
        contractId: contract.id,
        reviewerId,
        revieweeId,
        agencyId: contract.agencyId ?? null,
        rating,
        comment,
      });

      if (role === "client") {
        const jssContribution = getJSSContribution(rating);
        if (contract.agencyId) {
          await recordAgencyReviewStats(transaction, {
            agencyId: contract.agencyId,
            rating,
            jssContribution,
            now,
          });
        } else {
          await recordFreelancerReviewStats(transaction, {
            freelancerId: freelancerAccountId,
            rating,
            jssContribution,
            now,
          });
        }
      } else {
        await recordClientReviewStats(transaction, {
          clientId: contract.clientId,
          rating,
          now,
        });
      }

      if (!newlyCompleted) return;

      const [completed] = await markContractCompletedIfActive(
        transaction,
        contract.id,
        now,
      );
      if (!completed) throw contractAlreadyFinished();

      if (contract.agencyId) {
        await recordAgencyJobCompleted(transaction, contract.agencyId, now);
      } else {
        await recordFreelancerJobCompleted(
          transaction,
          freelancerAccountId,
          now,
        );
      }
      await recordClientContractCompleted(transaction, contract.clientId, now);

      if (contract.conversationId) {
        await appendConversationMessages(transaction, {
          conversationId: contract.conversationId,
          messages: [
            {
              sender_id: reviewerId,
              message_type: "SYSTEM_EVENT",
              body: `The contract “${contract.title}” was completed.`,
              event_type: "CONTRACT_COMPLETED",
              event_payload: { contractId: contract.id, title: contract.title },
              created_at: now,
            },
          ],
          updatedAt: now,
          unread: {
            account: revieweeId,
            agency: role === "client" ? contract.agencyId : null,
          },
        });
      }
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, REVIEW_CONTRACT_REVIEWER_UNIQUE)) {
        throw reviewAlreadySubmitted();
      }
      throw error;
    });

  return {
    id: contract.id,
    title: contract.title,
    revieweeId,
    agencyId: role === "client" ? contract.agencyId : null,
    conversationId: contract.conversationId,
    newlyCompleted,
  };
};

export const acceptContract = async (
  contractId: string,
  freelancerId: string,
  agencyId?: string | null,
) => {
  const [offer] = await findFundedContractOffer(db, {
    contractId,
    freelancerId,
    agencyId,
  });

  if (!offer) throw new ApiError(404, "Funded contract offer not found.");
  if (!offer.identityVerified) {
    throw new ApiError(403, "Identity verification is required.");
  }
  if (offer.status !== "PENDING") {
    throw new ApiError(409, "Contract offer has already been handled.");
  }

  const offerNotAcceptable = () =>
    new ApiError(
      409,
      "Contract offer was already handled.",
      "CONTRACT_OFFER_NOT_ACCEPTABLE",
    );

  const now = new Date();
  await db.transaction(async (transaction) => {
    const [contract] = await markContractActiveIfPending(
      transaction,
      offer.id,
      now,
    );
    if (!contract) throw offerNotAcceptable();

    const [activated] = await markMilestoneActiveIfFundedAndPending(
      transaction,
      offer.milestoneId,
      now,
    );
    if (!activated) throw offerNotAcceptable();

    if (agencyId) {
      await recordAgencyJobStarted(transaction, agencyId, now);
    } else {
      await recordFreelancerJobStarted(transaction, freelancerId, now);
    }
    await recordClientContractStarted(transaction, offer.clientId, now);

    const [message] = await appendConversationMessages(transaction, {
      conversationId: offer.conversationId,
      messages: [
        {
          sender_id: freelancerId,
          message_type: "SYSTEM_EVENT",
          body: agencyId
            ? "The agency accepted the contract offer. The contract is now active."
            : "The freelancer accepted the contract offer. The contract is now active.",
          event_type: "CONTRACT_ACCEPTED",
          event_payload: { contractId: offer.id, title: offer.title },
        },
      ],
      updatedAt: now,
      unread: { account: offer.clientId },
    });
    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");
  });

  return { ...offer, freelancerId };
};

export const createContractFromPayment = async (
  session: Stripe.Checkout.Session,
) => {
  if (
    session.payment_status !== "paid" ||
    session.metadata?.paymentType !== "CONTRACT_MILESTONE"
  ) {
    return;
  }

  const proposalId = session.metadata.proposalId;
  const clientId = session.metadata.clientId;
  if (!proposalId || !clientId) {
    throw new ApiError(400, "Stripe contract metadata is missing.");
  }

  const [offer] = await findProposalOfferForContractCreation(
    db,
    proposalId,
    clientId,
  );

  if (!offer) throw new ApiError(404, "Contract offer data not found.");
  const isAgency = offer.proposal.sender_type === "AGENCY";

  const milestones = offer.job.milestones;
  const amounts = milestones.map((milestone) => milestone.budgetCents);
  const totalAmountCents = amounts.reduce((total, amount) => total + amount, 0);
  if (
    !milestones.length ||
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1) ||
    !Number.isSafeInteger(totalAmountCents)
  ) {
    throw new ApiError(400, "Contract milestones are invalid.");
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const firstMilestoneAmount = amounts[0]!;
  if (
    stripeCustomerId !== offer.stripeCustomerId ||
    session.amount_total !== firstMilestoneAmount ||
    session.currency !== "usd"
  ) {
    throw new ApiError(400, "Stripe contract payment does not match.");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  const result = await db.transaction(async (transaction) => {
    const [contract] = await insertContractIfProposalUnused(transaction, {
      proposal_id: offer.proposal.id,
      job_id: offer.job.id,
      client_id: clientId,
      freelancer_id: isAgency ? null : offer.proposal.sender_id,
      agency_id: isAgency ? offer.proposal.sender_id : null,
      title: offer.job.title,
      total_amount_cents: totalAmountCents,
      status: "PENDING",
    });

    if (!contract) return;

    await insertContractMilestones(
      transaction,
      milestones.map((milestone, position) => ({
        contract_id: contract.id,
        title: milestone.title,
        amount_cents: amounts[position]!,
        due_date: milestone.dueDate,
        position,
        stripe_checkout_session_id: position === 0 ? session.id : undefined,
        stripe_payment_intent_id: position === 0 ? paymentIntentId : undefined,
        funded_at: position === 0 ? new Date() : undefined,
      })),
    );

    await markPaymentMethodVerified(transaction, clientId);

    const [message] = await appendConversationMessages(transaction, {
      conversationId: offer.conversationId,
      messages: [
        {
          sender_id: clientId,
          message_type: "SYSTEM_EVENT",
          body: "Contract offer sent",
          event_type: "CONTRACT_OFFER",
          event_payload: {
            contractId: contract.id,
            proposalId: offer.proposal.id,
            title: offer.job.title,
            firstMilestone: {
              title: milestones[0]!.title,
              amountCents: amounts[0],
            },
          },
        },
      ],
      updatedAt: new Date(),
      unread: { allExceptType: "CLIENT" },
    });
    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");

    return { contractId: contract.id };
  });

  if (!result) return;

  await sendNotification(
    isAgency
      ? {
          agencyId: offer.proposal.sender_id,
          type: "CONTRACT_OFFER",
          title: "New contract offer",
          message: `A client sent you a contract offer for “${offer.job.title}”.`,
          link: `/messages?conversationId=${offer.conversationId}`,
          metadata: {
            contractId: result.contractId,
            proposalId: offer.proposal.id,
          },
        }
      : {
          recipientId: offer.proposal.sender_id,
          type: "CONTRACT_OFFER",
          title: "New contract offer",
          message: `A client sent you a contract offer for “${offer.job.title}”.`,
          link: `/messages?conversationId=${offer.conversationId}`,
          metadata: {
            contractId: result.contractId,
            proposalId: offer.proposal.id,
          },
        },
  );

  await emitConversationUpdate(offer.conversationId, clientId);
};
