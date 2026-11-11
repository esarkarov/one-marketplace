import type Stripe from "stripe";
import { createClerkClient } from "@clerk/backend";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { stripe } from "../../config/stripe.js";
import { db } from "../../database/client.js";
import {
  accounts,
  agency_earning,
  agency_metadata,
  client_metadata,
  client_spents,
  contract_milestones,
  contracts,
  earning_history,
  freelancer_earning,
  conversation_participants,
  conversations,
  job_posts,
  messages,
  proposals,
  reviews,
} from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import { splitFee } from "../../utils/money.js";
import { sendNotification } from "../../events/publisher.js";
import { emitConversationUpdate } from "../messaging/messaging.socket.js";
import { getJSSContribution } from "../freelancer/freelancer.service.js";
import { getAgencyOwnerId } from "../agency/agency.service.js";

const participantMatch = (accountId: string, agencyId?: string | null) =>
  agencyId
    ? eq(conversation_participants.agency_id, agencyId)
    : eq(conversation_participants.account_id, accountId);

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
    await db
      .update(accounts)
      .set({ stripe_customer_id: customerId, updated_at: new Date() })
      .where(eq(accounts.auth_id, clientId));
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

  const [milestone] = await db
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

    const [message] = await transaction
      .insert(messages)
      .values({
        conversation_id: milestone.conversationId,
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
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    if (!message) throw new ApiError(500, "Milestone funding message failed.");
    await transaction
      .update(conversations)
      .set({
        last_message_id: message.id,
        last_message_at: message.createdAt,
        updated_at: now,
      })
      .where(eq(conversations.id, milestone.conversationId));
    await transaction
      .update(conversation_participants)
      .set({ unread_count: sql`${conversation_participants.unread_count} + 1` })
      .where(
        and(
          eq(
            conversation_participants.conversation_id,
            milestone.conversationId,
          ),
          participantMatch(recipientId, milestone.agencyId),
        ),
      );
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

export const getAccountContracts = async (
  userId: string,
  role: "client" | "freelancer" | "agency",
  agencyId?: string | null,
) => {
  const rows = await db
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

  const counterpartyIds = [
    ...new Set(
      rows
        .map((row) => (role === "client" ? row.freelancerId : row.clientId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const names = new Map<string, string>();
  const avatars = new Map<string, string | null>();
  if (env.clerkSecretKey && counterpartyIds.length) {
    const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
    await Promise.all(
      counterpartyIds.map(async (accountId) => {
        try {
          const user = await clerk.users.getUser(accountId);
          names.set(
            accountId,
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              "Marketplace user",
          );
          avatars.set(accountId, user.imageUrl || null);
        } catch {
          names.set(accountId, "Marketplace user");
          avatars.set(accountId, null);
        }
      }),
    );
  }

  const agencyIds = [
    ...new Set(
      role === "client"
        ? rows
            .map((row) => row.agencyId)
            .filter((id): id is string => Boolean(id))
        : [],
    ),
  ];
  const agencyNames = new Map<string, string>();
  const agencyAvatars = new Map<string, string | null>();
  if (agencyIds.length) {
    const agencyRows = await db
      .select({
        id: agency_metadata.id,
        name: agency_metadata.name,
        avatar: agency_metadata.avatar_image,
      })
      .from(agency_metadata)
      .where(inArray(agency_metadata.id, agencyIds));
    agencyRows.forEach((row) => {
      agencyNames.set(row.id, row.name ?? "Agency");
      agencyAvatars.set(row.id, row.avatar?.url ?? null);
    });
  }

  const result = new Map<string, any>();
  for (const row of rows) {
    const counterpartyId =
      role === "client" ? (row.freelancerId ?? row.agencyId) : row.clientId;
    const isAgencyCounterparty =
      role === "client" && !row.freelancerId && Boolean(row.agencyId);
    const contract = result.get(row.id) ?? {
      id: row.id,
      proposalId: row.proposalId,
      jobId: row.jobId,
      title: row.title,
      description: row.description,
      totalAmountCents: row.totalAmountCents,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      conversationId: row.conversationId,
      counterpartyId,
      counterpartyName: isAgencyCounterparty
        ? (agencyNames.get(row.agencyId!) ?? "Agency")
        : ((role === "freelancer" || role === "agency"
            ? row.clientCompanyName
            : null) ??
          names.get(counterpartyId ?? "") ??
          "Marketplace user"),
      counterpartyAvatar: isAgencyCounterparty
        ? (agencyAvatars.get(row.agencyId!) ?? null)
        : (avatars.get(counterpartyId ?? "") ?? null),
      reviewedByCurrentUser: row.reviewedByCurrentUser,
      milestones: [],
    };
    contract.milestones.push({
      id: row.milestoneId,
      title: row.milestoneTitle,
      amountCents: row.milestoneAmountCents,
      dueDate: row.milestoneDueDate,
      position: row.milestonePosition,
      status: row.milestoneStatus,
      fundedAt: row.milestoneFundedAt,
      paymentRequestedAt: row.milestonePaymentRequestedAt,
      submissionMessage: row.milestoneSubmissionMessage,
      submissionDeliveryLink: row.milestoneSubmissionDeliveryLink,
      completedAt: row.milestoneCompletedAt,
    });
    result.set(row.id, contract);
  }

  return [...result.values()];
};

export const finishContractWithReview = async (
  contractId: string,
  reviewerId: string,
  role: "client" | "freelancer",
  rating: number,
  comment: string,
  agencyId?: string | null,
) => {
  const [contract] = await db
    .select({
      id: contracts.id,
      title: contracts.title,
      status: contracts.status,
      clientId: contracts.client_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      conversationId: conversations.id,
      incompleteMilestones: sql<number>`(
        select count(*)::int from contract_milestones incomplete
        where incomplete.contract_id = ${contracts.id}
          and incomplete.status <> 'COMPLETED'
      )`,
      // Same "agency as one entity" check as reviewedByCurrentUser above:
      // once any teammate reviews on the agency's behalf, no other teammate
      // should be able to submit a second review for the same contract.
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

  if (!contract) throw new ApiError(404, "Contract not found.");
  if (contract.status === "PENDING") {
    throw new ApiError(409, "This contract has not started yet.");
  }
  if (contract.incompleteMilestones > 0) {
    throw new ApiError(
      409,
      "Complete every milestone before finishing the contract.",
    );
  }
  if (contract.existingReview > 0) {
    throw new ApiError(409, "You have already reviewed this contract.");
  }

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

  await db.transaction(async (transaction) => {
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
      .where(and(eq(contracts.id, contract.id), eq(contracts.status, "ACTIVE")))
      .returning({ id: contracts.id });
    if (!completed) throw new ApiError(409, "Contract was already finished.");

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
      const [message] = await transaction
        .insert(messages)
        .values({
          conversation_id: contract.conversationId,
          sender_id: reviewerId,
          message_type: "SYSTEM_EVENT",
          body: `The contract “${contract.title}” was completed.`,
          event_type: "CONTRACT_COMPLETED",
          event_payload: { contractId: contract.id, title: contract.title },
          created_at: now,
        })
        .returning({ id: messages.id, createdAt: messages.created_at });
      if (message) {
        await transaction
          .update(conversations)
          .set({
            last_message_id: message.id,
            last_message_at: message.createdAt,
            updated_at: now,
          })
          .where(eq(conversations.id, contract.conversationId));
        await transaction
          .update(conversation_participants)
          .set({
            unread_count: sql`${conversation_participants.unread_count} + 1`,
          })
          .where(
            and(
              eq(
                conversation_participants.conversation_id,
                contract.conversationId,
              ),
              participantMatch(
                revieweeId,
                role === "client" ? contract.agencyId : null,
              ),
            ),
          );
      }
    }
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

  const now = new Date();
  await db.transaction(async (transaction) => {
    const [contract] = await transaction
      .update(contracts)
      .set({ status: "ACTIVE", started_at: now, updated_at: now })
      .where(and(eq(contracts.id, offer.id), eq(contracts.status, "PENDING")))
      .returning({ id: contracts.id });
    if (!contract)
      throw new ApiError(409, "Contract offer was already handled.");

    await transaction
      .update(contract_milestones)
      .set({ status: "ACTIVE", updated_at: now })
      .where(eq(contract_milestones.id, offer.milestoneId));

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

    const [message] = await transaction
      .insert(messages)
      .values({
        conversation_id: offer.conversationId,
        sender_id: freelancerId,
        message_type: "SYSTEM_EVENT",
        body: agencyId
          ? "The agency accepted the contract offer. The contract is now active."
          : "The freelancer accepted the contract offer. The contract is now active.",
        event_type: "CONTRACT_ACCEPTED",
        event_payload: { contractId: offer.id, title: offer.title },
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");

    await transaction
      .update(conversations)
      .set({
        last_message_id: message.id,
        last_message_at: message.createdAt,
        updated_at: now,
      })
      .where(eq(conversations.id, offer.conversationId));

    await transaction
      .update(conversation_participants)
      .set({
        unread_count: sql`${conversation_participants.unread_count} + 1`,
      })
      .where(
        and(
          eq(conversation_participants.conversation_id, offer.conversationId),
          eq(conversation_participants.account_id, offer.clientId),
        ),
      );
  });

  return { ...offer, freelancerId };
};

export const submitContractMilestone = async (
  contractId: string,
  milestoneId: string,
  freelancerId: string,
  submissionMessage: string,
  submissionDeliveryLink?: string,
  agencyId?: string | null,
) => {
  const [milestone] = await db
    .select({
      contractId: contracts.id,
      contractTitle: contracts.title,
      contractStatus: contracts.status,
      clientId: contracts.client_id,
      milestoneId: contract_milestones.id,
      milestoneTitle: contract_milestones.title,
      milestoneAmountCents: contract_milestones.amount_cents,
      milestoneStatus: contract_milestones.status,
      fundedAt: contract_milestones.funded_at,
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

  if (!milestone) throw new ApiError(404, "Contract milestone not found.");
  if (
    milestone.contractStatus !== "ACTIVE" ||
    milestone.milestoneStatus !== "ACTIVE" ||
    !milestone.fundedAt
  ) {
    throw new ApiError(
      409,
      "Only the active funded milestone can be submitted.",
    );
  }

  const now = new Date();
  await db.transaction(async (transaction) => {
    await transaction
      .update(contract_milestones)
      .set({
        submission_message: submissionMessage,
        submission_delivery_link: submissionDeliveryLink ?? null,
        payment_requested_at: now,
        updated_at: now,
      })
      .where(eq(contract_milestones.id, milestone.milestoneId));

    const [message] = await transaction
      .insert(messages)
      .values({
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
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    if (!message)
      throw new ApiError(500, "Milestone submission could not be sent.");

    await transaction
      .update(conversations)
      .set({
        last_message_id: message.id,
        last_message_at: message.createdAt,
        updated_at: now,
      })
      .where(eq(conversations.id, milestone.conversationId));
    await transaction
      .update(conversation_participants)
      .set({ unread_count: sql`${conversation_participants.unread_count} + 1` })
      .where(
        and(
          eq(
            conversation_participants.conversation_id,
            milestone.conversationId,
          ),
          eq(conversation_participants.account_id, milestone.clientId),
        ),
      );
  });

  return milestone;
};

const notAwaitingReview = () =>
  new ApiError(409, "This milestone is not awaiting review.");

const EARNING_MILESTONE_UNIQUE = "earning_history_milestone_id_unique";

const isEarningMilestoneConflict = (error: unknown): boolean => {
  for (
    let current: unknown = error, depth = 0;
    typeof current === "object" && current !== null && depth < 3;
    current = (current as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, constraint } = current as {
      code?: unknown;
      constraint?: unknown;
    };
    if (code === "23505" && constraint === EARNING_MILESTONE_UNIQUE) {
      return true;
    }
  }
  return false;
};

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
      const insertedMessages = await transaction
        .insert(messages)
        .values(reviewMessages)
        .returning({ id: messages.id, createdAt: messages.created_at });
      const message = insertedMessages.at(-1);
      if (!message)
        throw new ApiError(500, "Milestone review could not be sent.");

      await transaction
        .update(conversations)
        .set({
          last_message_id: message.id,
          last_message_at: message.createdAt,
          updated_at: now,
        })
        .where(eq(conversations.id, milestone.conversationId));
      await transaction
        .update(conversation_participants)
        .set({
          unread_count: sql`${conversation_participants.unread_count} + ${insertedMessages.length}`,
        })
        .where(
          and(
            eq(
              conversation_participants.conversation_id,
              milestone.conversationId,
            ),
            participantMatch(freelancerAccountId, milestone.agencyId),
          ),
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
  const [contract] = await db
    .select({
      id: contracts.id,
      jobId: contracts.job_id,
      freelancerId: contracts.freelancer_id,
      agencyId: contracts.agency_id,
      status: contracts.status,
      jobMilestones: job_posts.milestones,
      conversationId: conversations.id,
      incompleteMilestones: sql<number>`(
        select count(*)::int from contract_milestones incomplete
        where incomplete.contract_id = ${contracts.id}
          and incomplete.status <> 'COMPLETED'
      )`,
      nextPosition: sql<number>`(
        select coalesce(max(existing.position), -1)::int + 1
        from contract_milestones existing
        where existing.contract_id = ${contracts.id}
      )`,
    })
    .from(contracts)
    .innerJoin(job_posts, eq(job_posts.id, contracts.job_id))
    .leftJoin(
      conversations,
      eq(conversations.proposal_id, contracts.proposal_id),
    )
    .where(and(eq(contracts.id, contractId), eq(contracts.client_id, clientId)))
    .limit(1);

  if (!contract) throw new ApiError(404, "Contract not found.");
  if (contract.status !== "ACTIVE" || contract.incompleteMilestones > 0) {
    throw new ApiError(
      409,
      "New milestones can be added only after all current milestones are completed.",
    );
  }

  const freelancerAccountId =
    contract.freelancerId ??
    (contract.agencyId ? await getAgencyOwnerId(contract.agencyId) : null);
  if (!freelancerAccountId) {
    throw new ApiError(500, "Contract owner could not be resolved.");
  }

  const now = new Date();
  const result = await db.transaction(async (transaction) => {
    const [milestone] = await transaction
      .insert(contract_milestones)
      .values({
        contract_id: contract.id,
        title: input.title,
        amount_cents: input.amountCents,
        due_date: input.dueDate,
        position: contract.nextPosition,
        status: "PENDING",
      })
      .returning({ id: contract_milestones.id });
    if (!milestone) throw new ApiError(500, "Milestone could not be added.");

    const updatedJobMilestones = [
      ...contract.jobMilestones,
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
    const [message] = await transaction
      .insert(messages)
      .values({
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
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    if (!message) throw new ApiError(500, "Milestone event could not be sent.");
    await transaction
      .update(conversations)
      .set({
        last_message_id: message.id,
        last_message_at: message.createdAt,
        updated_at: now,
      })
      .where(eq(conversations.id, contract.conversationId));
    await transaction
      .update(conversation_participants)
      .set({ unread_count: sql`${conversation_participants.unread_count} + 1` })
      .where(
        and(
          eq(
            conversation_participants.conversation_id,
            contract.conversationId,
          ),
          participantMatch(freelancerAccountId, contract.agencyId),
        ),
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

    const [message] = await transaction
      .insert(messages)
      .values({
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
      })
      .returning({ id: messages.id, createdAt: messages.created_at });

    if (!message)
      throw new ApiError(500, "Contract message could not be sent.");

    await transaction
      .update(conversations)
      .set({
        last_message_id: message.id,
        last_message_at: message.createdAt,
        updated_at: new Date(),
      })
      .where(eq(conversations.id, offer.conversationId));

    await transaction
      .update(conversation_participants)
      .set({
        unread_count: sql`${conversation_participants.unread_count} + 1`,
      })
      .where(
        and(
          eq(conversation_participants.conversation_id, offer.conversationId),
          ne(conversation_participants.participant_type, "CLIENT"),
        ),
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
