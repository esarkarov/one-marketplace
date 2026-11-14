import type Stripe from "stripe";
import { env } from "../../../config/env.js";
import { stripe } from "../../../infrastructure/stripe.js";
import { db } from "../../../database/client.js";
import { setStripeCustomerId } from "../../auth/auth.public.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import {
  appendConversationMessages,
  emitConversationUpdate,
} from "../../messaging/messaging.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import {
  findMilestoneForFunding,
  findPendingMilestoneForPaymentFunding,
  findProposalOfferForCheckout,
} from "../contracts.repository.js";
import { markMilestoneFundedIfPending } from "../contracts.state.repository.js";

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
  if (!milestone) return;

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
    throw new ApiError(400, "Stripe milestone payment does not match.");
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
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

  if (!funded) return;
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
