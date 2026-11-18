import { db } from "../../../database/client.js";
import {
  countAgencyMembers,
  findAgencyOwnerLocation,
  listAgencyProposals,
  listClientJobProposalRows,
  listFreelancerProposals,
  listProposalStatusesBySender,
} from "../repositories/proposals.repository.js";
import { clerk } from "../../../infrastructure/auth/clerk.client.js";

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

export const getAgencyProposals = async (agencyId: string) => {
  const rows = await listAgencyProposals(db, agencyId);

  return rows.map((row) => ({
    ...row,
    clientRating: row.clientRating === null ? null : Number(row.clientRating),
  }));
};

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
