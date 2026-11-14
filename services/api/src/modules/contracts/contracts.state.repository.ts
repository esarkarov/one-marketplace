import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import {
  agency_earning,
  client_spents,
  contract_milestones,
  contracts,
  earning_history,
  freelancer_earning,
  reviews,
} from "./contracts.schema.js";

export const lockContractStatusForUpdate = (
  executor: DbExecutor,
  contractId: string,
) =>
  executor
    .select({ status: contracts.status })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .for("update");

export const countIncompleteMilestones = (
  executor: DbExecutor,
  contractId: string,
) =>
  executor
    .select({ count: sql<number>`count(*)::int` })
    .from(contract_milestones)
    .where(
      and(
        eq(contract_milestones.contract_id, contractId),
        ne(contract_milestones.status, "COMPLETED"),
      ),
    );

export const readMilestoneAppendState = (
  executor: DbExecutor,
  contractId: string,
) =>
  executor
    .select({
      incomplete: sql<number>`count(*) filter (where ${contract_milestones.status} <> 'COMPLETED')::int`,
      nextPosition: sql<number>`coalesce(max(${contract_milestones.position}), -1)::int + 1`,
    })
    .from(contract_milestones)
    .where(eq(contract_milestones.contract_id, contractId));

export const markMilestoneFundedIfPending = (
  executor: DbExecutor,
  input: {
    milestoneId: string;
    checkoutSessionId: string;
    paymentIntentId: string | undefined;
    now: Date;
  },
) =>
  executor
    .update(contract_milestones)
    .set({
      status: "ACTIVE",
      funded_at: input.now,
      stripe_checkout_session_id: input.checkoutSessionId,
      stripe_payment_intent_id: input.paymentIntentId,
      updated_at: input.now,
    })
    .where(
      and(
        eq(contract_milestones.id, input.milestoneId),
        eq(contract_milestones.status, "PENDING"),
      ),
    )
    .returning({ id: contract_milestones.id });

export const markMilestoneActiveIfFundedAndPending = (
  executor: DbExecutor,
  milestoneId: string,
  now: Date,
) =>
  executor
    .update(contract_milestones)
    .set({ status: "ACTIVE", updated_at: now })
    .where(
      and(
        eq(contract_milestones.id, milestoneId),
        eq(contract_milestones.status, "PENDING"),
        isNotNull(contract_milestones.funded_at),
      ),
    )
    .returning({ id: contract_milestones.id });

export const markMilestoneSubmittedIfActiveAndFunded = (
  executor: DbExecutor,
  input: {
    milestoneId: string;
    submissionMessage: string;
    submissionDeliveryLink: string | null;
    now: Date;
  },
) =>
  executor
    .update(contract_milestones)
    .set({
      submission_message: input.submissionMessage,
      submission_delivery_link: input.submissionDeliveryLink,
      payment_requested_at: input.now,
      updated_at: input.now,
    })
    .where(
      and(
        eq(contract_milestones.id, input.milestoneId),
        eq(contract_milestones.status, "ACTIVE"),
        isNotNull(contract_milestones.funded_at),
      ),
    )
    .returning({ id: contract_milestones.id });

export const markMilestoneReviewedIfAwaitingReview = (
  executor: DbExecutor,
  input: { milestoneId: string; approved: boolean; now: Date },
) =>
  executor
    .update(contract_milestones)
    .set(
      input.approved
        ? {
            status: "COMPLETED",
            completed_at: input.now,
            updated_at: input.now,
          }
        : { payment_requested_at: null, updated_at: input.now },
    )
    .where(
      and(
        eq(contract_milestones.id, input.milestoneId),
        eq(contract_milestones.status, "ACTIVE"),
        isNotNull(contract_milestones.payment_requested_at),
      ),
    )
    .returning({ id: contract_milestones.id });

export const markContractActiveIfPending = (
  executor: DbExecutor,
  contractId: string,
  now: Date,
) =>
  executor
    .update(contracts)
    .set({ status: "ACTIVE", started_at: now, updated_at: now })
    .where(and(eq(contracts.id, contractId), eq(contracts.status, "PENDING")))
    .returning({ id: contracts.id });

export const markContractCompletedIfActive = (
  executor: DbExecutor,
  contractId: string,
  now: Date,
) =>
  executor
    .update(contracts)
    .set({ status: "COMPLETED", completed_at: now, updated_at: now })
    .where(and(eq(contracts.id, contractId), eq(contracts.status, "ACTIVE")))
    .returning({ id: contracts.id });

export const insertContractIfProposalUnused = (
  executor: DbExecutor,
  values: typeof contracts.$inferInsert,
) =>
  executor
    .insert(contracts)
    .values(values)
    .onConflictDoNothing({ target: contracts.proposal_id })
    .returning({ id: contracts.id });

export const insertContractMilestones = async (
  executor: DbExecutor,
  rows: (typeof contract_milestones.$inferInsert)[],
) => {
  await executor.insert(contract_milestones).values(rows);
};

export const insertPendingMilestone = (
  executor: DbExecutor,
  values: {
    contractId: string;
    title: string;
    amountCents: number;
    dueDate: string;
    position: number;
  },
) =>
  executor
    .insert(contract_milestones)
    .values({
      contract_id: values.contractId,
      title: values.title,
      amount_cents: values.amountCents,
      due_date: values.dueDate,
      position: values.position,
      status: "PENDING",
    })
    .returning({ id: contract_milestones.id });

export const addToContractTotal = async (
  executor: DbExecutor,
  contractId: string,
  amountCents: number,
  now: Date,
) => {
  await executor
    .update(contracts)
    .set({
      total_amount_cents: sql`${contracts.total_amount_cents} + ${amountCents}`,
      updated_at: now,
    })
    .where(eq(contracts.id, contractId));
};

export const insertReview = async (
  executor: DbExecutor,
  values: {
    contractId: string;
    reviewerId: string;
    revieweeId: string;
    agencyId: string | null;
    rating: number;
    comment: string;
  },
) => {
  await executor.insert(reviews).values({
    contract_id: values.contractId,
    reviewer_id: values.reviewerId,
    reviewee_id: values.revieweeId,
    agency_id: values.agencyId,
    rating: values.rating,
    comment: values.comment,
  });
};

export const recordAgencyReviewStats = async (
  executor: DbExecutor,
  input: {
    agencyId: string;
    rating: number;
    jssContribution: number;
    now: Date;
  },
) => {
  const { rating, jssContribution, now } = input;
  await executor
    .insert(agency_earning)
    .values({
      agency_id: input.agencyId,
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
};

export const recordFreelancerReviewStats = async (
  executor: DbExecutor,
  input: {
    freelancerId: string;
    rating: number;
    jssContribution: number;
    now: Date;
  },
) => {
  const { rating, jssContribution, now } = input;
  await executor
    .insert(freelancer_earning)
    .values({
      freelancer_id: input.freelancerId,
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
};

export const recordClientReviewStats = async (
  executor: DbExecutor,
  input: { clientId: string; rating: number; now: Date },
) => {
  const { rating, now } = input;
  await executor
    .insert(client_spents)
    .values({
      client_id: input.clientId,
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
};

export const recordAgencyJobCompleted = async (
  executor: DbExecutor,
  agencyId: string,
  now: Date,
) => {
  await executor
    .insert(agency_earning)
    .values({ agency_id: agencyId, completed_jobs: 1 })
    .onConflictDoUpdate({
      target: agency_earning.agency_id,
      set: {
        ongoing_jobs: sql`greatest(${agency_earning.ongoing_jobs} - 1, 0)`,
        completed_jobs: sql`${agency_earning.completed_jobs} + 1`,
        updated_at: now,
      },
    });
};

export const recordFreelancerJobCompleted = async (
  executor: DbExecutor,
  freelancerId: string,
  now: Date,
) => {
  await executor
    .insert(freelancer_earning)
    .values({ freelancer_id: freelancerId, completed_jobs: 1 })
    .onConflictDoUpdate({
      target: freelancer_earning.freelancer_id,
      set: {
        ongoing_jobs: sql`greatest(${freelancer_earning.ongoing_jobs} - 1, 0)`,
        completed_jobs: sql`${freelancer_earning.completed_jobs} + 1`,
        updated_at: now,
      },
    });
};

export const recordClientContractCompleted = async (
  executor: DbExecutor,
  clientId: string,
  now: Date,
) => {
  await executor
    .insert(client_spents)
    .values({ client_id: clientId, completed_contracts: 1 })
    .onConflictDoUpdate({
      target: client_spents.client_id,
      set: {
        ongoing_contracts: sql`greatest(${client_spents.ongoing_contracts} - 1, 0)`,
        completed_contracts: sql`${client_spents.completed_contracts} + 1`,
        updated_at: now,
      },
    });
};

export const recordAgencyJobStarted = async (
  executor: DbExecutor,
  agencyId: string,
  now: Date,
) => {
  await executor
    .insert(agency_earning)
    .values({ agency_id: agencyId, ongoing_jobs: 1 })
    .onConflictDoUpdate({
      target: agency_earning.agency_id,
      set: {
        ongoing_jobs: sql`${agency_earning.ongoing_jobs} + 1`,
        updated_at: now,
      },
    });
};

export const recordFreelancerJobStarted = async (
  executor: DbExecutor,
  freelancerId: string,
  now: Date,
) => {
  await executor
    .insert(freelancer_earning)
    .values({ freelancer_id: freelancerId, ongoing_jobs: 1 })
    .onConflictDoUpdate({
      target: freelancer_earning.freelancer_id,
      set: {
        ongoing_jobs: sql`${freelancer_earning.ongoing_jobs} + 1`,
        updated_at: now,
      },
    });
};

export const recordClientContractStarted = async (
  executor: DbExecutor,
  clientId: string,
  now: Date,
) => {
  await executor
    .insert(client_spents)
    .values({ client_id: clientId, ongoing_contracts: 1 })
    .onConflictDoUpdate({
      target: client_spents.client_id,
      set: {
        ongoing_contracts: sql`${client_spents.ongoing_contracts} + 1`,
        updated_at: now,
      },
    });
};

export const addAgencyEarning = async (
  executor: DbExecutor,
  agencyId: string,
  netCents: number,
  now: Date,
) => {
  await executor
    .insert(agency_earning)
    .values({ agency_id: agencyId, total_earning_cents: netCents })
    .onConflictDoUpdate({
      target: agency_earning.agency_id,
      set: {
        total_earning_cents: sql`${agency_earning.total_earning_cents} + ${netCents}`,
        updated_at: now,
      },
    });
};

export const addFreelancerEarning = async (
  executor: DbExecutor,
  freelancerId: string,
  netCents: number,
  now: Date,
) => {
  await executor
    .insert(freelancer_earning)
    .values({ freelancer_id: freelancerId, total_earning_cents: netCents })
    .onConflictDoUpdate({
      target: freelancer_earning.freelancer_id,
      set: {
        total_earning_cents: sql`${freelancer_earning.total_earning_cents} + ${netCents}`,
        updated_at: now,
      },
    });
};

export const addClientSpent = async (
  executor: DbExecutor,
  clientId: string,
  grossCents: number,
  now: Date,
) => {
  await executor
    .insert(client_spents)
    .values({ client_id: clientId, total_spent_cents: grossCents })
    .onConflictDoUpdate({
      target: client_spents.client_id,
      set: {
        total_spent_cents: sql`${client_spents.total_spent_cents} + ${grossCents}`,
        updated_at: now,
      },
    });
};

export const insertEarningHistory = async (
  executor: DbExecutor,
  values: typeof earning_history.$inferInsert,
) => {
  await executor.insert(earning_history).values(values);
};
