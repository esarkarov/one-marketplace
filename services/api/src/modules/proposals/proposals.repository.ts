import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import {
  agency_earning,
  client_spents,
  contracts,
  freelancer_earning,
} from "../contracts/contracts.schema.js";
import { agency_members, agency_metadata } from "../agency/agency.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { conversations } from "../messaging/messaging.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import { proposals } from "./proposals.schema.js";

type SenderType = "FREELANCER" | "AGENCY";

export const findPublishedJobForProposal = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [job] = await executor
    .select({
      id: job_posts.id,
      title: job_posts.title,
      clientId: job_posts.client_id,
      screeningQuestions: job_posts.screening_questions,
    })
    .from(job_posts)
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);
  return job;
};

export const findAgencyName = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [agency] = await executor
    .select({ name: agency_metadata.name })
    .from(agency_metadata)
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return agency;
};

export const insertProposalIfAbsent = async (
  executor: DbExecutor,
  input: {
    jobId: string;
    senderId: string;
    senderType: SenderType;
    coverLetter: string;
    bidAmountCents: number;
    duration: string;
    screeningAnswers: { question: string; answer: string }[];
  },
) => {
  const [proposal] = await executor
    .insert(proposals)
    .values({
      job_id: input.jobId,
      sender_id: input.senderId,
      sender_type: input.senderType,
      cover_letter: input.coverLetter,
      bid_amount_cents: input.bidAmountCents,
      duration: input.duration,
      screening_answers: input.screeningAnswers,
    })
    .onConflictDoNothing()
    .returning();
  return proposal;
};

export const listProposalStatusesBySender = (
  executor: DbExecutor,
  senderId: string,
  senderType: SenderType,
) =>
  executor
    .select({
      jobId: proposals.job_id,
      status: proposals.status,
      submittedAt: proposals.created_at,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.sender_id, senderId),
        eq(proposals.sender_type, senderType),
      ),
    )
    .orderBy(desc(proposals.created_at));

export const listFreelancerProposals = (
  executor: DbExecutor,
  freelancerId: string,
) =>
  executor
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      title: job_posts.title,
      company: client_metadata.company_name,
      status: proposals.status,
      submittedAt: proposals.created_at,
      budgetCents: job_posts.total_budget_cents,
      bidAmountCents: proposals.bid_amount_cents,
      duration: proposals.duration,
      coverLetter: proposals.cover_letter,
      skills: job_posts.skills,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .leftJoin(client_metadata, eq(job_posts.client_id, client_metadata.auth_id))
    .where(
      and(
        eq(proposals.sender_id, freelancerId),
        eq(proposals.sender_type, "FREELANCER"),
      ),
    )
    .orderBy(desc(proposals.created_at));

export const listAgencyProposals = (executor: DbExecutor, agencyId: string) =>
  executor
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      title: job_posts.title,
      company: client_metadata.company_name,
      status: proposals.status,
      submittedAt: proposals.created_at,
      budgetCents: job_posts.total_budget_cents,
      bidAmountCents: proposals.bid_amount_cents,
      duration: proposals.duration,
      coverLetter: proposals.cover_letter,
      skills: job_posts.skills,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
      clientTotalSpentCents: client_spents.total_spent_cents,
      conversationId: conversations.id,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .leftJoin(client_metadata, eq(job_posts.client_id, client_metadata.auth_id))
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .leftJoin(conversations, eq(conversations.proposal_id, proposals.id))
    .where(
      and(
        eq(proposals.sender_id, agencyId),
        eq(proposals.sender_type, "AGENCY"),
      ),
    )
    .orderBy(desc(proposals.created_at));

export const listClientJobProposalRows = (
  executor: DbExecutor,
  clientId: string,
  jobId: string,
) =>
  executor
    .select({
      id: proposals.id,
      conversationId: conversations.id,
      contractId: contracts.id,
      contractStatus: contracts.status,
      senderId: proposals.sender_id,
      senderType: proposals.sender_type,
      freelancerId: freelancer_metadata.id,
      verified: accounts.identityVerified,
      professionalTitle: freelancer_metadata.professional_title,
      country: freelancer_metadata.country,
      city: freelancer_metadata.city,
      skills: freelancer_metadata.skills,
      coverLetter: proposals.cover_letter,
      bidAmountCents: proposals.bid_amount_cents,
      duration: proposals.duration,
      screeningAnswers: proposals.screening_answers,
      status: proposals.status,
      isShortlisted: proposals.is_shortlisted,
      submittedAt: proposals.created_at,
      jobSuccessScore: freelancer_earning.job_success_score,
      rating: freelancer_earning.rating,
      completedJobs: freelancer_earning.completed_jobs,
      agencyJobSuccessScore: agency_earning.job_success_score,
      agencyRating: agency_earning.rating,
      agencyCompletedJobs: agency_earning.completed_jobs,
      agencyName: agency_metadata.name,
      agencyAvatar: agency_metadata.avatar_image,
      agencyTags: agency_metadata.tags,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .leftJoin(
      freelancer_metadata,
      eq(proposals.sender_id, freelancer_metadata.auth_id),
    )
    .leftJoin(accounts, eq(proposals.sender_id, accounts.auth_id))
    .leftJoin(conversations, eq(conversations.proposal_id, proposals.id))
    .leftJoin(contracts, eq(contracts.proposal_id, proposals.id))
    .leftJoin(
      freelancer_earning,
      eq(proposals.sender_id, freelancer_earning.freelancer_id),
    )
    .leftJoin(
      agency_metadata,
      sql`${proposals.sender_id} = ${agency_metadata.id}::text`,
    )
    .leftJoin(
      agency_earning,
      sql`${proposals.sender_id} = ${agency_earning.agency_id}::text`,
    )
    .where(and(eq(proposals.job_id, jobId), eq(job_posts.client_id, clientId)))
    .orderBy(desc(proposals.created_at));

export const countAgencyMembers = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(agency_members)
    .where(eq(agency_members.agency_id, agencyId));
  return row;
};

export const findAgencyOwnerLocation = async (
  executor: DbExecutor,
  agencyId: string,
) => {
  const [owner] = await executor
    .select({
      city: freelancer_metadata.city,
      country: freelancer_metadata.country,
    })
    .from(agency_metadata)
    .leftJoin(
      freelancer_metadata,
      eq(agency_metadata.owner_id, freelancer_metadata.auth_id),
    )
    .where(eq(agency_metadata.id, agencyId))
    .limit(1);
  return owner;
};

export const findClientProposalForView = async (
  executor: DbExecutor,
  proposalId: string,
  clientId: string,
) => {
  const [existing] = await executor
    .select({
      id: proposals.id,
      senderId: proposals.sender_id,
      senderType: proposals.sender_type,
      status: proposals.status,
      jobTitle: job_posts.title,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .where(and(eq(proposals.id, proposalId), eq(job_posts.client_id, clientId)))
    .limit(1);
  return existing;
};

export const markProposalViewedIfSubmitted = async (
  executor: DbExecutor,
  proposalId: string,
) => {
  const [updated] = await executor
    .update(proposals)
    .set({ status: "VIEWED", updated_at: new Date() })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, "SUBMITTED")))
    .returning();
  return updated;
};

export const markProposalShortlistedForClient = async (
  executor: DbExecutor,
  proposalId: string,
  clientId: string,
) => {
  const [proposal] = await executor
    .update(proposals)
    .set({ is_shortlisted: true, updated_at: new Date() })
    .from(job_posts)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.job_id, job_posts.id),
        eq(job_posts.client_id, clientId),
      ),
    )
    .returning({ id: proposals.id, isShortlisted: proposals.is_shortlisted });
  return proposal;
};

export const findClientProposalForInterview = async (
  executor: DbExecutor,
  proposalId: string,
  clientId: string,
) => {
  const [proposal] = await executor
    .select({
      id: proposals.id,
      freelancerId: proposals.sender_id,
      senderType: proposals.sender_type,
      coverLetter: proposals.cover_letter,
      jobId: proposals.job_id,
      jobTitle: job_posts.title,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .where(and(eq(proposals.id, proposalId), eq(job_posts.client_id, clientId)))
    .limit(1);
  return proposal;
};

export const markProposalInterviewedIfOpen = async (
  executor: DbExecutor,
  proposalId: string,
) => {
  const [interviewed] = await executor
    .update(proposals)
    .set({ status: "INTERVIEWED", updated_at: new Date() })
    .where(
      and(
        eq(proposals.id, proposalId),
        inArray(proposals.status, ["SUBMITTED", "VIEWED"]),
      ),
    )
    .returning({ id: proposals.id });
  return interviewed;
};
