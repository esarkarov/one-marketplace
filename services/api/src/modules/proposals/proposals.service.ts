import { db } from "../../database/client.js";
import {
  countAgencyMembers,
  findAgencyName,
  findAgencyOwnerLocation,
  findClientProposalForInterview,
  findClientProposalForView,
  findPublishedJobForProposal,
  insertProposalIfAbsent,
  listAgencyProposals,
  listClientJobProposalRows,
  listFreelancerProposals,
  listProposalStatusesBySender,
  markProposalInterviewedIfOpen,
  markProposalShortlistedForClient,
  markProposalViewedIfSubmitted,
} from "./proposals.repository.js";
import {
  creditConnects,
  debitConnects,
  recordConnectsHistory,
} from "../connects/connects.public.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
  PROPOSAL_CONNECTS,
} from "../../config/constants.js";
import { redis } from "../../infrastructure/redis.js";
import { clerk } from "../../infrastructure/clerk.js";
import {
  getAgencyOwnerId,
  getAgencyTeamMemberIds,
} from "../agency/agency.public.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";
import {
  emitConversationUpdate,
  openInterviewConversation,
} from "../messaging/messaging.public.js";

export const submitProposal = async (
  freelancerId: string,
  input: {
    jobId: string;
    coverLetter: string;
    bidAmountCents: number;
    duration: string;
    screeningAnswers: string[];
  },
) => {
  const result = await db.transaction(async (transaction) => {
    const job = await findPublishedJobForProposal(transaction, input.jobId);
    if (!job) throw new ApiError(404, "Job post not found.");
    if (job.clientId === freelancerId) {
      throw new ApiError(403, "You cannot submit a proposal to your own job.");
    }
    const questions = job.screeningQuestions ?? [];
    if (
      input.screeningAnswers.length !== questions.length ||
      input.screeningAnswers.some((answer) => !answer)
    ) {
      throw new ApiError(400, "Answer every screening question.");
    }

    const balance = await debitConnects(
      transaction,
      { freelancerId },
      PROPOSAL_CONNECTS,
    );

    if (!balance) throw new ApiError(400, "Not enough Connects.");

    const proposal = await insertProposalIfAbsent(transaction, {
      jobId: input.jobId,
      senderId: freelancerId,
      senderType: "FREELANCER",
      coverLetter: input.coverLetter,
      bidAmountCents: input.bidAmountCents,
      duration: input.duration,
      screeningAnswers: questions.map((question, index) => ({
        question,
        answer: input.screeningAnswers[index]!,
      })),
    });
    if (!proposal)
      throw new ApiError(409, "You already submitted a proposal for this job.");

    await recordConnectsHistory(transaction, {
      connectsId: balance.id,
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
    bidAmountCents: number;
    duration: string;
    screeningAnswers: string[];
  },
) => {
  const result = await db.transaction(async (transaction) => {
    const job = await findPublishedJobForProposal(transaction, input.jobId);
    if (!job) throw new ApiError(404, "Job post not found.");
    if ((await getAgencyTeamMemberIds(agencyId)).includes(job.clientId)) {
      throw new ApiError(
        403,
        "Your agency cannot submit a proposal to a job posted by its own team.",
      );
    }
    const questions = job.screeningQuestions ?? [];
    if (
      input.screeningAnswers.length !== questions.length ||
      input.screeningAnswers.some((answer) => !answer)
    ) {
      throw new ApiError(400, "Answer every screening question.");
    }

    const agency = await findAgencyName(transaction, agencyId);
    if (!agency) throw new ApiError(404, "Agency workspace not found.");

    const balance = await debitConnects(
      transaction,
      { agencyId },
      PROPOSAL_CONNECTS,
    );

    if (!balance) throw new ApiError(400, "Not enough Connects.");

    const proposal = await insertProposalIfAbsent(transaction, {
      jobId: input.jobId,
      senderId: agencyId,
      senderType: "AGENCY",
      coverLetter: input.coverLetter,
      bidAmountCents: input.bidAmountCents,
      duration: input.duration,
      screeningAnswers: questions.map((question, index) => ({
        question,
        answer: input.screeningAnswers[index]!,
      })),
    });
    if (!proposal) {
      throw new ApiError(
        409,
        "Your agency already submitted a proposal for this job.",
      );
    }

    await recordConnectsHistory(transaction, {
      connectsId: balance.id,
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
  const freelancerProposals = await listProposalStatusesBySender(
    db,
    freelancerId,
    "FREELANCER",
  );

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
  const agencyProposals = await listProposalStatusesBySender(
    db,
    agencyId,
    "AGENCY",
  );

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
  listFreelancerProposals(db, freelancerId);

export const getAgencyProposals = async (agencyId: string) =>
  listAgencyProposals(db, agencyId);

export const getClientJobProposals = async (
  clientId: string,
  jobId: string,
) => {
  const rows = await listClientJobProposalRows(db, clientId, jobId);

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
          const { count: memberCount } = (await countAgencyMembers(
            db,
            senderId,
          )) ?? { count: 0 };
          const owner = await findAgencyOwnerLocation(db, senderId);

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
  const existing = await findClientProposalForView(db, proposalId, clientId);
  if (!existing) throw new ApiError(404, "Proposal not found.");

  if (existing.status !== "SUBMITTED") {
    return { ...existing, changed: false };
  }

  const updated = await markProposalViewedIfSubmitted(db, proposalId);

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
  const proposal = await markProposalShortlistedForClient(
    db,
    proposalId,
    clientId,
  );
  if (!proposal) throw new ApiError(404, "Proposal not found.");
  return proposal;
};

export const startProposalInterview = async (
  proposalId: string,
  clientId: string,
  openingMessage: string,
) => {
  const result = await db.transaction(async (transaction) => {
    const proposal = await findClientProposalForInterview(
      transaction,
      proposalId,
      clientId,
    );
    if (!proposal) throw new ApiError(404, "Proposal not found.");

    const isAgency = proposal.senderType === "AGENCY";

    const accountId = isAgency
      ? await getAgencyOwnerId(proposal.freelancerId)
      : proposal.freelancerId;
    if (!accountId) {
      throw new ApiError(404, "Agency workspace not found.");
    }

    const interviewed = await markProposalInterviewedIfOpen(
      transaction,
      proposal.id,
    );
    if (!interviewed) {
      throw new ApiError(409, "Interview has already been started.");
    }

    const contextKey = isAgency
      ? `job:${proposal.jobId}:client:${clientId}:agency:${proposal.freelancerId}`
      : `job:${proposal.jobId}:client:${clientId}:talent:${proposal.freelancerId}`;
    const { conversationId } = await openInterviewConversation(transaction, {
      proposalId: proposal.id,
      jobId: proposal.jobId,
      contextKey,
      clientId,
      senderAccountId: accountId,
      counterparty: isAgency
        ? { agencyId: proposal.freelancerId }
        : { accountId },
      coverLetter: proposal.coverLetter,
      openingMessage,
    });

    const balance = await creditConnects(
      transaction,
      isAgency
        ? { agencyId: proposal.freelancerId }
        : { freelancerId: proposal.freelancerId },
      PROPOSAL_CONNECTS,
    );
    if (!balance) throw new ApiError(404, "Connects balance not found.");

    await recordConnectsHistory(transaction, {
      connectsId: balance.id,
      type: "Interview started refund",
      description: proposal.jobTitle,
      amount: PROPOSAL_CONNECTS,
    });

    return {
      conversationId,
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
