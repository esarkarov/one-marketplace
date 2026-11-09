import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../database/client.js";
import {
  accounts,
  agency_earning,
  agency_members,
  agency_metadata,
  client_metadata,
  client_spents,
  connects,
  connects_history,
  contracts,
  conversation_participants,
  conversations,
  freelancer_earning,
  freelancer_metadata,
  job_posts,
  messages,
  proposals,
} from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
  PROPOSAL_CONNECTS,
} from "../../config/constants.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { createClerkClient } from "@clerk/backend";
import { getAgencyOwnerId } from "../agency/agency.service.js";
import { sendNotification } from "../../events/publisher.js";
import { emitConversationUpdate } from "../messaging/messaging.socket.js";

export const submitProposal = async (
  freelancerId: string,
  input: {
    jobId: string;
    coverLetter: string;
    bidAmount: number;
    duration: string;
    screeningAnswers: string[];
  },
) => {
  const result = await db.transaction(async (transaction) => {
    const [job] = await transaction
      .select({
        id: job_posts.id,
        title: job_posts.title,
        clientId: job_posts.client_id,
        screeningQuestions: job_posts.screening_questions,
      })
      .from(job_posts)
      .where(
        and(eq(job_posts.id, input.jobId), eq(job_posts.status, "PUBLISHED")),
      )
      .limit(1);
    if (!job) throw new ApiError(404, "Job post not found.");
    const questions = job.screeningQuestions ?? [];
    if (
      input.screeningAnswers.length !== questions.length ||
      input.screeningAnswers.some((answer) => !answer)
    ) {
      throw new ApiError(400, "Answer every screening question.");
    }

    const [balance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} - ${PROPOSAL_CONNECTS}`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(connects.freelancer_id, freelancerId),
          gte(connects.connects, PROPOSAL_CONNECTS),
        ),
      )
      .returning();

    if (!balance) throw new ApiError(400, "Not enough Connects.");

    const [proposal] = await transaction
      .insert(proposals)
      .values({
        job_id: input.jobId,
        sender_id: freelancerId,
        sender_type: "FREELANCER",
        cover_letter: input.coverLetter,
        bid_amount: input.bidAmount.toString(),
        duration: input.duration,
        screening_answers: questions.map((question, index) => ({
          question,
          answer: input.screeningAnswers[index]!,
        })),
      })
      .onConflictDoNothing()
      .returning();
    if (!proposal)
      throw new ApiError(409, "You already submitted a proposal for this job.");

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
      type: "Proposal submitted",
      description: job.title,
      amount: -PROPOSAL_CONNECTS,
    });
    return {
      proposal,
      connects: balance.connects,
      clientId: job.clientId,
      jobTitle: job.title,
    };
  });

  await redis.setEx(
    getConnectsCacheKey(freelancerId),
    CONNECTS_CACHE_TTL_SECONDS,
    String(result.connects),
  );

  await sendNotification({
    recipientId: result.clientId,
    type: "PROPOSAL_RECEIVED",
    title: "New proposal received",
    message: `A freelancer applied to “${result.jobTitle}”.`,
    link: `/proposals/${input.jobId}`,
    metadata: { proposalId: result.proposal.id, jobId: input.jobId },
  });

  return result;
};

export const submitAgencyProposal = async (
  agencyId: string,
  input: {
    jobId: string;
    coverLetter: string;
    bidAmount: number;
    duration: string;
    screeningAnswers: string[];
  },
) => {
  const result = await db.transaction(async (transaction) => {
    const [job] = await transaction
      .select({
        id: job_posts.id,
        title: job_posts.title,
        clientId: job_posts.client_id,
        screeningQuestions: job_posts.screening_questions,
      })
      .from(job_posts)
      .where(
        and(eq(job_posts.id, input.jobId), eq(job_posts.status, "PUBLISHED")),
      )
      .limit(1);
    if (!job) throw new ApiError(404, "Job post not found.");
    const questions = job.screeningQuestions ?? [];
    if (
      input.screeningAnswers.length !== questions.length ||
      input.screeningAnswers.some((answer) => !answer)
    ) {
      throw new ApiError(400, "Answer every screening question.");
    }

    const [agency] = await transaction
      .select({ name: agency_metadata.name })
      .from(agency_metadata)
      .where(eq(agency_metadata.id, agencyId))
      .limit(1);
    if (!agency) throw new ApiError(404, "Agency workspace not found.");

    const [balance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} - ${PROPOSAL_CONNECTS}`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(connects.agency_id, agencyId),
          gte(connects.connects, PROPOSAL_CONNECTS),
        ),
      )
      .returning();

    if (!balance) throw new ApiError(400, "Not enough Connects.");

    const [proposal] = await transaction
      .insert(proposals)
      .values({
        job_id: input.jobId,
        sender_id: agencyId,
        sender_type: "AGENCY",
        cover_letter: input.coverLetter,
        bid_amount: input.bidAmount.toString(),
        duration: input.duration,
        screening_answers: questions.map((question, index) => ({
          question,
          answer: input.screeningAnswers[index]!,
        })),
      })
      .onConflictDoNothing()
      .returning();
    if (!proposal) {
      throw new ApiError(
        409,
        "Your agency already submitted a proposal for this job.",
      );
    }

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
      type: "Proposal submitted",
      description: job.title,
      amount: -PROPOSAL_CONNECTS,
    });

    return {
      proposal,
      connects: balance.connects,
      clientId: job.clientId,
      jobTitle: job.title,
      agencyName: agency.name,
    };
  });

  await redis.setEx(
    getAgencyConnectsCacheKey(agencyId),
    CONNECTS_CACHE_TTL_SECONDS,
    String(result.connects),
  );

  await sendNotification({
    recipientId: result.clientId,
    type: "PROPOSAL_RECEIVED",
    title: "New proposal received",
    message: `${result.agencyName} applied to “${result.jobTitle}”.`,
    link: `/proposals/${input.jobId}`,
    metadata: { proposalId: result.proposal.id, jobId: input.jobId },
  });

  return result;
};

const ACTIVE_PROPOSAL_STATUSES = new Set([
  "SUBMITTED",
  "VIEWED",
  "INTERVIEWED",
  "HIRED",
]);

export const getFreelancerProposalMetadata = async (freelancerId: string) => {
  const freelancerProposals = await db
    .select({
      jobId: proposals.job_id,
      status: proposals.status,
      submittedAt: proposals.created_at,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.sender_id, freelancerId),
        eq(proposals.sender_type, "FREELANCER"),
      ),
    )
    .orderBy(desc(proposals.created_at));

  const normalizedProposals = freelancerProposals.map((proposal) => ({
    ...proposal,
    status: proposal.status.toUpperCase(),
  }));

  return {
    proposals: normalizedProposals,
    counts: {
      total: normalizedProposals.length,
      active: normalizedProposals.filter((proposal) =>
        ACTIVE_PROPOSAL_STATUSES.has(proposal.status),
      ).length,
      viewed: normalizedProposals.filter(
        (proposal) => proposal.status === "VIEWED",
      ).length,
      interviewed: normalizedProposals.filter(
        (proposal) => proposal.status === "INTERVIEWED",
      ).length,
    },
  };
};

export const getAgencyProposalMetadata = async (agencyId: string) => {
  const agencyProposals = await db
    .select({
      jobId: proposals.job_id,
      status: proposals.status,
      submittedAt: proposals.created_at,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.sender_id, agencyId),
        eq(proposals.sender_type, "AGENCY"),
      ),
    )
    .orderBy(desc(proposals.created_at));

  const normalizedProposals = agencyProposals.map((proposal) => ({
    ...proposal,
    status: proposal.status.toUpperCase(),
  }));

  return {
    proposals: normalizedProposals,
    counts: {
      total: normalizedProposals.length,
      active: normalizedProposals.filter((proposal) =>
        ACTIVE_PROPOSAL_STATUSES.has(proposal.status),
      ).length,
      viewed: normalizedProposals.filter(
        (proposal) => proposal.status === "VIEWED",
      ).length,
      interviewed: normalizedProposals.filter(
        (proposal) => proposal.status === "INTERVIEWED",
      ).length,
    },
  };
};

export const getFreelancerProposals = async (freelancerId: string) =>
  db
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      title: job_posts.title,
      company: client_metadata.company_name,
      status: proposals.status,
      submittedAt: proposals.created_at,
      budget: job_posts.total_budget,
      bidAmount: proposals.bid_amount,
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

export const getAgencyProposals = async (agencyId: string) =>
  db
    .select({
      id: proposals.id,
      jobId: proposals.job_id,
      title: job_posts.title,
      company: client_metadata.company_name,
      status: proposals.status,
      submittedAt: proposals.created_at,
      budget: job_posts.total_budget,
      bidAmount: proposals.bid_amount,
      duration: proposals.duration,
      coverLetter: proposals.cover_letter,
      skills: job_posts.skills,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
      clientTotalSpent: client_spents.total_spent,
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

export const getClientJobProposals = async (
  clientId: string,
  jobId: string,
) => {
  const rows = await db
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
      bidAmount: proposals.bid_amount,
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

  const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
  return Promise.all(
    rows.map(
      async ({
        senderId,
        senderType,
        jobSuccessScore,
        rating,
        completedJobs,
        agencyJobSuccessScore,
        agencyRating,
        agencyCompletedJobs,
        agencyName,
        agencyAvatar,
        agencyTags,
        ...proposal
      }) => {
        const stats =
          senderType === "AGENCY"
            ? {
                jobSuccessScore: Number(agencyJobSuccessScore ?? 0),
                rating: Number(agencyRating ?? 0),
                completedJobs: Number(agencyCompletedJobs ?? 0),
              }
            : {
                jobSuccessScore: Number(jobSuccessScore ?? 0),
                rating: Number(rating ?? 0),
                completedJobs: Number(completedJobs ?? 0),
              };

        if (senderType === "AGENCY") {
          const [{ count: memberCount } = { count: 0 }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(agency_members)
            .where(eq(agency_members.agency_id, senderId));

          const [owner] = await db
            .select({
              city: freelancer_metadata.city,
              country: freelancer_metadata.country,
            })
            .from(agency_metadata)
            .leftJoin(
              freelancer_metadata,
              eq(agency_metadata.owner_id, freelancer_metadata.auth_id),
            )
            .where(eq(agency_metadata.id, senderId))
            .limit(1);

          return {
            ...proposal,
            ...stats,
            senderId,
            senderType,
            senderName: agencyName ?? "Agency",
            avatar: agencyAvatar?.url ?? null,
            memberCount,
            agencyTags: agencyTags ?? [],
            city: owner?.city ?? null,
            country: owner?.country ?? null,
          };
        }

        try {
          const user = await clerk.users.getUser(senderId);
          return {
            ...proposal,
            ...stats,
            senderId,
            senderType,
            senderName: user.fullName,
            avatar: user.imageUrl || null,
          };
        } catch {
          return {
            ...proposal,
            ...stats,
            senderId,
            senderType,
            senderName: null,
            avatarUrl: null,
          };
        }
      },
    ),
  );
};

export const updateProposal = async (proposalId: string, clientId: string) => {
  const [existing] = await db
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
  if (!existing) throw new ApiError(404, "Proposal not found.");

  if (existing.status !== "SUBMITTED") {
    return { ...existing, changed: false };
  }

  const [updated] = await db
    .update(proposals)
    .set({ status: "VIEWED", updated_at: new Date() })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, "SUBMITTED")))
    .returning();

  return {
    ...existing,
    status: updated?.status ?? existing.status,
    changed: Boolean(updated),
  };
};

export const shortlistProposal = async (
  proposalId: string,
  clientId: string,
) => {
  const [proposal] = await db
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
  if (!proposal) throw new ApiError(404, "Proposal not found.");
  return proposal;
};

export const startProposalInterview = async (
  proposalId: string,
  clientId: string,
  openingMessage: string,
) => {
  const result = await db.transaction(async (transaction) => {
    const [proposal] = await transaction
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
      .where(
        and(eq(proposals.id, proposalId), eq(job_posts.client_id, clientId)),
      )
      .limit(1);
    if (!proposal) throw new ApiError(404, "Proposal not found.");

    const isAgency = proposal.senderType === "AGENCY";

    const accountId = isAgency
      ? await getAgencyOwnerId(proposal.freelancerId)
      : proposal.freelancerId;
    if (!accountId) {
      throw new ApiError(404, "Agency workspace not found.");
    }

    const [interviewed] = await transaction
      .update(proposals)
      .set({ status: "INTERVIEWED", updated_at: new Date() })
      .where(
        and(
          eq(proposals.id, proposal.id),
          inArray(proposals.status, ["SUBMITTED", "VIEWED"]),
        ),
      )
      .returning({ id: proposals.id });
    if (!interviewed) {
      throw new ApiError(409, "Interview has already been started.");
    }

    const contextKey = isAgency
      ? `job:${proposal.jobId}:client:${clientId}:agency:${proposal.freelancerId}`
      : `job:${proposal.jobId}:client:${clientId}:talent:${proposal.freelancerId}`;
    const [createdConversation] = await transaction
      .insert(conversations)
      .values({
        job_id: proposal.jobId,
        proposal_id: proposal.id,
        context_key: contextKey,
      })
      .onConflictDoNothing({ target: conversations.context_key })
      .returning({ id: conversations.id });

    const conversation =
      createdConversation ??
      (
        await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.context_key, contextKey))
          .limit(1)
      )[0];

    if (!conversation) {
      throw new ApiError(500, "Conversation could not be created.");
    }

    await transaction
      .insert(conversation_participants)
      .values([
        {
          conversation_id: conversation.id,
          account_id: clientId,
          participant_type: "CLIENT",
        },
        isAgency
          ? {
              conversation_id: conversation.id,
              agency_id: proposal.freelancerId,
              participant_type: "AGENCY",
            }
          : {
              conversation_id: conversation.id,
              account_id: accountId,
              participant_type: "FREELANCER",
            },
      ])
      .onConflictDoNothing();

    const now = new Date();

    const [proposalMessage] = await transaction
      .insert(messages)
      .values({
        conversation_id: conversation.id,
        sender_id: accountId,
        body: proposal.coverLetter,
        created_at: now,
      })
      .returning({ id: messages.id, createdAt: messages.created_at });
    if (!proposalMessage) {
      throw new ApiError(500, "Interview messages could not be created.");
    }

    const [clientMessage] = await transaction
      .insert(messages)
      .values({
        conversation_id: conversation.id,
        sender_id: clientId,
        body: openingMessage,
        reply_to_message_id: proposalMessage.id,
        created_at: new Date(now.getTime() + 1),
      })
      .returning({ id: messages.id, createdAt: messages.created_at });

    if (!clientMessage) {
      throw new ApiError(500, "Interview messages could not be created.");
    }

    await transaction
      .update(conversations)
      .set({
        proposal_id: proposal.id,
        last_message_id: clientMessage.id,
        last_message_at: clientMessage.createdAt,
        updated_at: new Date(),
      })
      .where(eq(conversations.id, conversation.id));

    await transaction
      .update(conversation_participants)
      .set({
        last_read_message_id: clientMessage.id,
        last_read_at: new Date(),
        unread_count: 0,
      })
      .where(
        and(
          eq(conversation_participants.conversation_id, conversation.id),
          eq(conversation_participants.account_id, clientId),
        ),
      );

    await transaction
      .update(conversation_participants)
      .set({
        unread_count: sql`${conversation_participants.unread_count} + 1`,
      })
      .where(
        and(
          eq(conversation_participants.conversation_id, conversation.id),
          ne(conversation_participants.participant_type, "CLIENT"),
        ),
      );

    const [balance] = await transaction
      .update(connects)
      .set({
        connects: sql`${connects.connects} + ${PROPOSAL_CONNECTS}`,
        updated_at: new Date(),
      })
      .where(
        isAgency
          ? eq(connects.agency_id, proposal.freelancerId)
          : eq(connects.freelancer_id, proposal.freelancerId),
      )
      .returning();
    if (!balance) throw new ApiError(404, "Connects balance not found.");

    await transaction.insert(connects_history).values({
      connects_id: balance.id,
      type: "Interview started refund",
      description: proposal.jobTitle,
      amount: PROPOSAL_CONNECTS,
    });

    return {
      conversationId: conversation.id,
      proposalId: proposal.id,
      senderType: proposal.senderType,
      freelancerId: accountId,
      agencyId: isAgency ? proposal.freelancerId : null,
      jobTitle: proposal.jobTitle,
      connects: balance.connects,
    };
  });

  if (result.senderType === "AGENCY" && result.agencyId) {
    await redis.setEx(
      getAgencyConnectsCacheKey(result.agencyId),
      CONNECTS_CACHE_TTL_SECONDS,
      String(result.connects),
    );
  } else {
    await redis.setEx(
      getConnectsCacheKey(result.freelancerId),
      CONNECTS_CACHE_TTL_SECONDS,
      String(result.connects),
    );
  }

  await emitConversationUpdate(result.conversationId);
  return result;
};
