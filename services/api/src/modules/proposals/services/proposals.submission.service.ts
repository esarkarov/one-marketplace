import { db } from "../../../database/client.js";
import {
  findAgencyName,
  findPublishedJobForProposal,
  insertProposalIfAbsent,
} from "../repositories/proposals.repository.js";
import { debitConnects, recordConnectsHistory } from "../../connects/index.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
  PROPOSAL_CONNECTS,
} from "../../../config/constants.js";
import { redis } from "../../../infrastructure/cache/redis.js";
import { getAgencyTeamMemberIds } from "../../agency/index.js";
import { sendNotification } from "../../../infrastructure/events/publisher.js";

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
