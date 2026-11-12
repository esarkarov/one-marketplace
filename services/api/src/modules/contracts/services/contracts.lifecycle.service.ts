import type Stripe from "stripe";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../../../database/client.js";
import { isUniqueViolation } from "../../../database/pg-errors.js";
import {
  accounts,
  agency_earning,
  client_spents,
  contract_milestones,
  contracts,
  freelancer_earning,
  conversation_participants,
  conversations,
  job_posts,
  proposals,
  reviews,
} from "../../../database/schema.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import { emitConversationUpdate } from "../../messaging/messaging.public.js";
import { getJSSContribution } from "../../freelancer/freelancer.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import {
  findContractForReview,
  incrementUnreadCount,
  insertMessages,
  setConversationLastMessage,
} from "../contracts.repository.js";
import { participantMatch } from "./contracts.helpers.js";

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
      const [locked] = await transaction
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contract.id))
        .for("update");
      if (!locked) throw new ApiError(404, "Contract not found.");
      if (newlyCompleted && locked.status !== "ACTIVE") {
        throw contractAlreadyFinished();
      }

      const [pending] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(contract_milestones)
        .where(
          and(
            eq(contract_milestones.contract_id, contract.id),
            ne(contract_milestones.status, "COMPLETED"),
          ),
        );
      if ((pending?.count ?? 0) > 0) throw contractHasIncompleteMilestones();

      await transaction.insert(reviews).values({
        contract_id: contract.id,
        reviewer_id: reviewerId,
        reviewee_id: revieweeId,
        agency_id: contract.agencyId ?? null,
        rating,
        comment,
      });

      if (role === "client") {
        const jssContribution = getJSSContribution(rating);
        if (contract.agencyId) {
          await transaction
            .insert(agency_earning)
            .values({
              agency_id: contract.agencyId,
              review_count: 1,
              rating: rating.toFixed(2),
              job_success_score: jssContribution.toFixed(2),
            })
            .onConflictDoUpdate({
              target: agency_earning.agency_id,
              set: {
                rating: sql`((${agency_earning.rating} * ${agency_earning.review_count}) + ${rating}) / (${agency_earning.review_count} + 1)`,
                job_success_score: sql`((${agency_earning.job_success_score} * ${agency_earning.review_count}) + ${jssContribution}) / (${agency_earning.review_count} + 1)`,
                review_count: sql`${agency_earning.review_count} + 1`,
                updated_at: now,
              },
            });
        } else {
          await transaction
            .insert(freelancer_earning)
            .values({
              freelancer_id: freelancerAccountId,
              review_count: 1,
              rating: rating.toFixed(2),
              job_success_score: jssContribution.toFixed(2),
            })
            .onConflictDoUpdate({
              target: freelancer_earning.freelancer_id,
              set: {
                rating: sql`((${freelancer_earning.rating} * ${freelancer_earning.review_count}) + ${rating}) / (${freelancer_earning.review_count} + 1)`,
                job_success_score: sql`((${freelancer_earning.job_success_score} * ${freelancer_earning.review_count}) + ${jssContribution}) / (${freelancer_earning.review_count} + 1)`,
                review_count: sql`${freelancer_earning.review_count} + 1`,
                updated_at: now,
              },
            });
        }
      } else {
        await transaction
          .insert(client_spents)
          .values({
            client_id: contract.clientId,
            review_count: 1,
            rating: rating.toFixed(2),
          })
          .onConflictDoUpdate({
            target: client_spents.client_id,
            set: {
              rating: sql`((${client_spents.rating} * ${client_spents.review_count}) + ${rating}) / (${client_spents.review_count} + 1)`,
              review_count: sql`${client_spents.review_count} + 1`,
              updated_at: now,
            },
          });
      }

      if (!newlyCompleted) return;

      const [completed] = await transaction
        .update(contracts)
        .set({ status: "COMPLETED", completed_at: now, updated_at: now })
        .where(
          and(eq(contracts.id, contract.id), eq(contracts.status, "ACTIVE")),
        )
        .returning({ id: contracts.id });
      if (!completed) throw contractAlreadyFinished();

      if (contract.agencyId) {
        await transaction
          .insert(agency_earning)
          .values({ agency_id: contract.agencyId, completed_jobs: 1 })
          .onConflictDoUpdate({
            target: agency_earning.agency_id,
            set: {
              ongoing_jobs: sql`greatest(${agency_earning.ongoing_jobs} - 1, 0)`,
              completed_jobs: sql`${agency_earning.completed_jobs} + 1`,
              updated_at: now,
            },
          });
      } else {
        await transaction
          .insert(freelancer_earning)
          .values({ freelancer_id: freelancerAccountId, completed_jobs: 1 })
          .onConflictDoUpdate({
            target: freelancer_earning.freelancer_id,
            set: {
              ongoing_jobs: sql`greatest(${freelancer_earning.ongoing_jobs} - 1, 0)`,
              completed_jobs: sql`${freelancer_earning.completed_jobs} + 1`,
              updated_at: now,
            },
          });
      }
      await transaction
        .insert(client_spents)
        .values({ client_id: contract.clientId, completed_contracts: 1 })
        .onConflictDoUpdate({
          target: client_spents.client_id,
          set: {
            ongoing_contracts: sql`greatest(${client_spents.ongoing_contracts} - 1, 0)`,
            completed_contracts: sql`${client_spents.completed_contracts} + 1`,
            updated_at: now,
          },
        });

      if (contract.conversationId) {
        const [message] = await insertMessages(transaction, [
          {
            conversation_id: contract.conversationId,
            sender_id: reviewerId,
            message_type: "SYSTEM_EVENT",
            body: `The contract “${contract.title}” was completed.`,
            event_type: "CONTRACT_COMPLETED",
            event_payload: { contractId: contract.id, title: contract.title },
            created_at: now,
          },
        ]);
        if (message) {
          await setConversationLastMessage(
            transaction,
            contract.conversationId,
            message,
            now,
          );
          await incrementUnreadCount(
            transaction,
            contract.conversationId,
            participantMatch(
              revieweeId,
              role === "client" ? contract.agencyId : null,
            ),
            1,
          );
        }
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
  const [offer] = await db
    .select({
      id: contracts.id,
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
    .innerJoin(accounts, eq(accounts.auth_id, freelancerId))
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
        eq(contracts.id, contractId),
        agencyId
          ? eq(contracts.agency_id, agencyId)
          : eq(contracts.freelancer_id, freelancerId),
      ),
    )
    .limit(1);

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
    const [contract] = await transaction
      .update(contracts)
      .set({ status: "ACTIVE", started_at: now, updated_at: now })
      .where(and(eq(contracts.id, offer.id), eq(contracts.status, "PENDING")))
      .returning({ id: contracts.id });
    if (!contract) throw offerNotAcceptable();

    const [activated] = await transaction
      .update(contract_milestones)
      .set({ status: "ACTIVE", updated_at: now })
      .where(
        and(
          eq(contract_milestones.id, offer.milestoneId),
          eq(contract_milestones.status, "PENDING"),
          isNotNull(contract_milestones.funded_at),
        ),
      )
      .returning({ id: contract_milestones.id });
    if (!activated) throw offerNotAcceptable();

    if (agencyId) {
      await transaction
        .insert(agency_earning)
        .values({ agency_id: agencyId, ongoing_jobs: 1 })
        .onConflictDoUpdate({
          target: agency_earning.agency_id,
          set: {
            ongoing_jobs: sql`${agency_earning.ongoing_jobs} + 1`,
            updated_at: now,
          },
        });
    } else {
      await transaction
        .insert(freelancer_earning)
        .values({ freelancer_id: freelancerId, ongoing_jobs: 1 })
        .onConflictDoUpdate({
          target: freelancer_earning.freelancer_id,
          set: {
            ongoing_jobs: sql`${freelancer_earning.ongoing_jobs} + 1`,
            updated_at: now,
          },
        });
    }
    await transaction
      .insert(client_spents)
      .values({ client_id: offer.clientId, ongoing_contracts: 1 })
      .onConflictDoUpdate({
        target: client_spents.client_id,
        set: {
          ongoing_contracts: sql`${client_spents.ongoing_contracts} + 1`,
          updated_at: now,
        },
      });

    const [message] = await insertMessages(transaction, [
      {
        conversation_id: offer.conversationId,
        sender_id: freelancerId,
        message_type: "SYSTEM_EVENT",
        body: agencyId
          ? "The agency accepted the contract offer. The contract is now active."
          : "The freelancer accepted the contract offer. The contract is now active.",
        event_type: "CONTRACT_ACCEPTED",
        event_payload: { contractId: offer.id, title: offer.title },
      },
    ]);
    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");

    await setConversationLastMessage(
      transaction,
      offer.conversationId,
      message,
      now,
    );

    await incrementUnreadCount(
      transaction,
      offer.conversationId,
      eq(conversation_participants.account_id, offer.clientId),
      1,
    );
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

  const [offer] = await db
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
    const [contract] = await transaction
      .insert(contracts)
      .values({
        proposal_id: offer.proposal.id,
        job_id: offer.job.id,
        client_id: clientId,
        freelancer_id: isAgency ? null : offer.proposal.sender_id,
        agency_id: isAgency ? offer.proposal.sender_id : null,
        title: offer.job.title,
        total_amount_cents: totalAmountCents,
        status: "PENDING",
      })
      .onConflictDoNothing({ target: contracts.proposal_id })
      .returning({ id: contracts.id });

    if (!contract) return;

    await transaction.insert(contract_milestones).values(
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

    await transaction
      .update(accounts)
      .set({ paymentMethodVerified: true, updated_at: new Date() })
      .where(eq(accounts.auth_id, clientId));

    const [message] = await insertMessages(transaction, [
      {
        conversation_id: offer.conversationId,
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
    ]);

    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");

    await setConversationLastMessage(
      transaction,
      offer.conversationId,
      message,
      new Date(),
    );

    await incrementUnreadCount(
      transaction,
      offer.conversationId,
      ne(conversation_participants.participant_type, "CLIENT"),
      1,
    );

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
