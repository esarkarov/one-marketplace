import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { env } from "../../../config/env.js";
import { stripe } from "../../../infrastructure/stripe.js";
import { db } from "../../../database/client.js";
import { accounts } from "../../auth/auth.schema.js";
import { setStripeCustomerId } from "../../auth/auth.public.js";
import { contract_milestones, contracts } from "../contracts.schema.js";
import { conversations } from "../../messaging/messaging.schema.js";
import { job_posts } from "../../jobs/jobs.schema.js";
import { proposals } from "../../proposals/proposals.schema.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";
import {
  appendConversationMessages,
  emitConversationUpdate,
} from "../../messaging/messaging.public.js";
import { getAgencyOwnerId } from "../../agency/agency.public.js";
import { findMilestoneForFunding } from "../contracts.repository.js";

export const createContractCheckout = async (
  clientId: string,
  proposalId: string,
) => {
  if (!env.stripeSecretKey || !env.clientDashboard) {
    throw new ApiError(503, "Contract payments are not configured.");
  }

  const [offer] = await db
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

  const [milestone] = await db
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
        eq(contracts.id, contractId),
        eq(contracts.client_id, clientId),
        eq(contracts.status, "ACTIVE"),
        eq(contract_milestones.id, milestoneId),
        eq(contract_milestones.status, "PENDING"),
      ),
    )
    .limit(1);
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
    const [updated] = await transaction
      .update(contract_milestones)
      .set({
        status: "ACTIVE",
        funded_at: now,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: now,
      })
      .where(
        and(
          eq(contract_milestones.id, milestone.milestoneId),
          eq(contract_milestones.status, "PENDING"),
        ),
      )
      .returning({ id: contract_milestones.id });
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
