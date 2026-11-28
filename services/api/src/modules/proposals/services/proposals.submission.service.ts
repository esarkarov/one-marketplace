import { requirePublicId } from "@/shared/ids/public-ids.js";
import { toProposalResponse } from "@/modules/proposals/utils/proposals.mappers.js";
import { db } from "@/database/client.js";
import {
  findAgencyName,
  findPublishedJobForProposal,
  insertProposalIfAbsent,
} from "@/modules/proposals/repositories/proposals.repository.js";
import { findAccountIdByAuthId } from "@/modules/auth/index.js";
import {
  cacheAgencyConnects,
  cacheFreelancerConnects,
  debitConnects,
  recordConnectsHistory,
} from "@/modules/connects/index.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { PROPOSAL_CONNECTS } from "@/modules/connects/index.js";
import { getAgencyTeamMemberIds } from "@/modules/agency/index.js";
import { notificationEventId } from "@/modules/notification-store/index.js";
import {
  enqueueNotification,
  sendUnlessQueued,
  type OutboxNotificationInput,
} from "@/modules/outbox/index.js";

const proposalReceivedNotice = (input: {
  proposalId: string;
  jobId: string;
  clientId: string;
  message: string;
}): OutboxNotificationInput => ({
  recipientId: input.clientId,
  type: "PROPOSAL_RECEIVED",
  title: "New proposal received",
  message: input.message,
  link: `/proposals/${input.jobId}`,
  metadata: { proposalId: input.proposalId, jobId: input.jobId },
  eventId: notificationEventId(
    "PROPOSAL_RECEIVED",
    input.proposalId,
    "received",
  ),
});

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

    const senderAccountId = requirePublicId(
      await findAccountIdByAuthId(transaction, freelancerId),
      "proposals_post",
      input.jobId,
    );

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
    const notice = proposalReceivedNotice({
      proposalId: proposal.id,
      jobId: input.jobId,
      clientId: job.clientId,
      message: `A freelancer applied to “${job.title}”.`,
    });
    return {
      proposal,
      senderAccountId,
      connects: balance.connects,
      clientId: job.clientId,
      clientAccountId: job.clientAccountId,
      jobTitle: job.title,
      notice,
      queued: await enqueueNotification(transaction, notice),
    };
  });

  await cacheFreelancerConnects(freelancerId, result.connects);

  await sendUnlessQueued(result.queued, result.notice);

  return {
    proposal: toProposalResponse(
      result.proposal,
      result.senderAccountId,
      "proposals_post",
    ),
    connects: result.connects,
    clientId: requirePublicId(
      result.clientAccountId,
      "proposals_post",
      result.proposal.id,
    ),
    jobTitle: result.jobTitle,
  };
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

    const notice = proposalReceivedNotice({
      proposalId: proposal.id,
      jobId: input.jobId,
      clientId: job.clientId,
      message: `${agency.name} applied to “${job.title}”.`,
    });
    return {
      proposal,
      connects: balance.connects,
      clientId: job.clientId,
      clientAccountId: job.clientAccountId,
      jobTitle: job.title,
      agencyName: agency.name,
      notice,
      queued: await enqueueNotification(transaction, notice),
    };
  });

  await cacheAgencyConnects(agencyId, result.connects);

  await sendUnlessQueued(result.queued, result.notice);

  return {
    proposal: toProposalResponse(
      result.proposal,
      null,
      "agency_post_proposals",
    ),
    connects: result.connects,
    clientId: requirePublicId(
      result.clientAccountId,
      "agency_post_proposals",
      result.proposal.id,
    ),
    jobTitle: result.jobTitle,
    agencyName: result.agencyName,
  };
};
