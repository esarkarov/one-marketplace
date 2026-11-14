import { db } from "../../../database/client.js";
import {
  findClientProposalForInterview,
  findClientProposalForView,
  markProposalInterviewedIfOpen,
  markProposalShortlistedForClient,
  markProposalViewedIfSubmitted,
} from "../repositories/proposals.repository.js";
import { creditConnects, recordConnectsHistory } from "../../connects/index.js";
import { ApiError } from "../../../shared/http/api-error.js";
import {
  CONNECTS_CACHE_TTL_SECONDS,
  getAgencyConnectsCacheKey,
  getConnectsCacheKey,
  PROPOSAL_CONNECTS,
} from "../../../config/constants.js";
import { redis } from "../../../infrastructure/redis.js";
import { getAgencyOwnerId } from "../../agency/index.js";
import {
  emitConversationUpdate,
  openInterviewConversation,
} from "../../messaging/index.js";

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
