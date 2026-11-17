import type Stripe from "stripe";
import { env } from "../../../config/env.js";
import { stripe } from "../../../infrastructure/payments/stripe.client.js";
import { db } from "../../../database/client.js";
import { logger } from "../../../config/logger.js";
import { setStripeCustomerId } from "../../auth/index.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { sendNotification } from "../../../infrastructure/events/notification.publisher.js";
import {
  appendConversationMessages,
  emitConversationUpdate,
} from "../../messaging/index.js";
import { getAgencyOwnerId } from "../../agency/index.js";
import {
  findContractIdByProposal,
  findMilestoneForFunding,
  findMilestoneIdByCheckoutSession,
  findPendingMilestoneForPaymentFunding,
  findProposalOfferForCheckout,
} from "../repositories/contracts.repository.js";
import { markMilestoneFundedIfPending } from "../repositories/contracts.state.repository.js";

const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

const checkoutExpiresAt = () =>
  Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS;

export type PaymentRefundCause =
  "duplicate_session" | "job_already_hired" | "amount_mismatch";

const paymentIntentIdOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;

const isChargeAlreadyRefunded = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "charge_already_refunded";

export const refundDuplicatePayment = async (
  session: Stripe.Checkout.Session,
  cause: PaymentRefundCause,
): Promise<void> => {
  const paymentIntentId = paymentIntentIdOf(session);
  const attributes = {
    "stripe.checkout_session_id": session.id,
    "stripe.payment_intent_id": paymentIntentId ?? null,
    "payment.refund_cause": cause,
    "payment.amount_cents": session.amount_total,
  };

  if (!paymentIntentId) {
    await logger.error({
      message: "Payment could not be refunded: payment intent is missing.",
      eventName: "payment.refund.failed",
      attributes,
    });
    throw new ApiError(500, "Payment intent is missing for refund.");
  }

  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: "duplicate" },
      { idempotencyKey: `refund:${paymentIntentId}` },
    );
  } catch (error) {
    if (isChargeAlreadyRefunded(error)) return;
    await logger.error({
      message: "Payment refund failed.",
      eventName: "payment.refund.failed",
      attributes: {
        ...attributes,
        "error.name": error instanceof Error ? error.name : "UnknownError",
      },
    });
    throw error;
  }

  await logger.warn({
    message: "Payment refunded.",
    eventName: "payment.refunded",
    attributes,
  });
};

export const refundUnrecordedPayment = async (
  session: Stripe.Checkout.Session,
  cause: PaymentRefundCause,
): Promise<void> => {
  const [recorded] = await findMilestoneIdByCheckoutSession(db, session.id);
  if (recorded) return;
  await refundDuplicatePayment(session, cause);
};

export const logPaymentMismatch = (
  session: Stripe.Checkout.Session,
  expectedAmountCents: number,
) =>
  logger.warn({
    message: "Stripe payment does not match the expected amount or customer.",
    eventName: "payment.mismatch",
    attributes: {
      "stripe.checkout_session_id": session.id,
      "payment.expected_amount_cents": expectedAmountCents,
      "payment.amount_cents": session.amount_total,
      "payment.currency": session.currency,
    },
  });

export const createContractCheckout = async (
  clientId: string,
  proposalId: string,
) => {
  if (!env.stripeSecretKey || !env.clientDashboard) {
    throw new ApiError(503, "Contract payments are not configured.");
  }

  const [offer] = await findProposalOfferForCheckout(db, proposalId, clientId);

  if (!offer) throw new ApiError(404, "Proposal not found.");
  if (offer.proposal.status !== "INTERVIEWED") {
    throw new ApiError(
      400,
      "Interview the freelancer before sending an offer.",
    );
  }

  const [existingContract] = await findContractIdByProposal(db, proposalId);
  if (existingContract) {
    throw new ApiError(
      409,
      "A contract already exists for this proposal.",
      "CONTRACT_EXISTS",
    );
  }
  if (offer.job.status === "HIRED") {
    throw new ApiError(
      409,
      "This job already has a hire.",
      "JOB_ALREADY_HIRED",
    );
  }

  const firstMilestone = offer.job.milestones[0];
  if (!firstMilestone) {
    throw new ApiError(400, "This job does not have a milestone to fund.");
  }

  const amountCents = firstMilestone.budgetCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    throw new ApiError(400, "The first milestone amount is invalid.");
  }

  let customerId = offer.account.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: offer.account.email,
      metadata: { accountId: clientId, role: "CLIENT" },
    });
    customerId = customer.id;
    await setStripeCustomerId(db, clientId, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    invoice_creation: { enabled: true },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: firstMilestone.title },
        },
      },
    ],
    client_reference_id: offer.proposal.id,
    expires_at: checkoutExpiresAt(),
    metadata: {
      paymentType: "CONTRACT_MILESTONE",
      proposalId: offer.proposal.id,
      jobId: offer.job.id,
      clientId,
    },
    success_url: `${env.clientDashboard}/proposals/${offer.job.id}?payment=success`,
    cancel_url: `${env.clientDashboard}/proposals/${offer.job.id}?payment=cancelled`,
  });

  if (!session.url) throw new ApiError(502, "Stripe Checkout could not start.");
  return session.url;
};

export const createMilestoneFundingCheckout = async (
  clientId: string,
  contractId: string,
  milestoneId: string,
  requirements?: string,
) => {
  if (!env.stripeSecretKey || !env.clientDashboard) {
    throw new ApiError(503, "Contract payments are not configured.");
  }

  const [milestone] = await findMilestoneForFunding(
    db,
    clientId,
    contractId,
    milestoneId,
  );

  if (!milestone) throw new ApiError(404, "Contract milestone not found.");
  if (
    milestone.contractStatus !== "ACTIVE" ||
    milestone.milestoneStatus !== "PENDING" ||
    milestone.fundedAt ||
    milestone.incompletePrevious > 0 ||
    milestone.activeMilestones > 0
  ) {
    throw new ApiError(409, "This milestone cannot be funded yet.");
  }
  if (!milestone.customerId) {
    throw new ApiError(409, "Client payment profile was not found.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: milestone.customerId,
    invoice_creation: { enabled: true },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: milestone.milestoneAmountCents,
          product_data: { name: milestone.milestoneTitle },
        },
      },
    ],
    client_reference_id: milestone.milestoneId,
    expires_at: checkoutExpiresAt(),
    metadata: {
      paymentType: "CONTRACT_MILESTONE_FUNDING",
      contractId: milestone.contractId,
      milestoneId: milestone.milestoneId,
      clientId,
      requirements: requirements ?? "",
    },
    success_url: `${env.clientDashboard}/contracts?contractId=${milestone.contractId}&funding=success`,
    cancel_url: `${env.clientDashboard}/contracts?contractId=${milestone.contractId}&funding=cancelled`,
  });

  if (!session.url) throw new ApiError(502, "Stripe Checkout could not start.");
  return session.url;
};

export const fundContractMilestoneFromPayment = async (
  session: Stripe.Checkout.Session,
) => {
  if (
    session.payment_status !== "paid" ||
    session.metadata?.paymentType !== "CONTRACT_MILESTONE_FUNDING"
  ) {
    return;
  }
  const { contractId, milestoneId, clientId } = session.metadata;
  if (!contractId || !milestoneId || !clientId) {
    throw new ApiError(400, "Stripe milestone metadata is missing.");
  }

  const [milestone] = await findPendingMilestoneForPaymentFunding(db, {
    contractId,
    clientId,
    milestoneId,
  });
  if (!milestone) {
    await refundUnrecordedPayment(session, "duplicate_session");
    return;
  }

  const recipientId =
    milestone.freelancerId ??
    (milestone.agencyId ? await getAgencyOwnerId(milestone.agencyId) : null);
  if (!recipientId)
    throw new ApiError(500, "Contract owner could not be resolved.");

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (
    customerId !== milestone.customerId ||
    session.amount_total !== milestone.milestoneAmountCents ||
    session.currency !== "usd"
  ) {
    await logPaymentMismatch(session, milestone.milestoneAmountCents);
    await refundUnrecordedPayment(session, "amount_mismatch");
    return;
  }

  const paymentIntentId = paymentIntentIdOf(session);
  const now = new Date();
  const funded = await db.transaction(async (transaction) => {
    const [updated] = await markMilestoneFundedIfPending(transaction, {
      milestoneId: milestone.milestoneId,
      checkoutSessionId: session.id,
      paymentIntentId,
      now,
    });
    if (!updated) return false;

    const [message] = await appendConversationMessages(transaction, {
      conversationId: milestone.conversationId,
      messages: [
        {
          sender_id: clientId,
          message_type: "SYSTEM_EVENT",
          body: `Milestone funded: “${milestone.milestoneTitle}”.`,
          event_type: "MILESTONE_FUNDED",
          event_payload: {
            contractId: milestone.contractId,
            milestoneId: milestone.milestoneId,
            milestoneTitle: milestone.milestoneTitle,
            amountCents: milestone.milestoneAmountCents,
            requirements: session.metadata?.requirements || null,
          },
        },
      ],
      updatedAt: now,
      unread: { account: recipientId, agency: milestone.agencyId },
    });
    if (!message) throw new ApiError(500, "Milestone funding message failed.");
    return true;
  });

  if (!funded) {
    await refundUnrecordedPayment(session, "duplicate_session");
    return;
  }
  await sendNotification(
    milestone.agencyId
      ? {
          agencyId: milestone.agencyId,
          type: "MILESTONE_FUNDED",
          title: "Milestone funded",
          message: `The client funded “${milestone.milestoneTitle}”. You can start work now.`,
          link: `/contracts?contractId=${milestone.contractId}`,
          metadata: {
            contractId: milestone.contractId,
            milestoneId: milestone.milestoneId,
          },
        }
      : {
          recipientId,
          type: "MILESTONE_FUNDED",
          title: "Milestone funded",
          message: `The client funded “${milestone.milestoneTitle}”. You can start work now.`,
          link: `/contracts?contractId=${milestone.contractId}`,
          metadata: {
            contractId: milestone.contractId,
            milestoneId: milestone.milestoneId,
          },
        },
  );
  await emitConversationUpdate(milestone.conversationId);
};
