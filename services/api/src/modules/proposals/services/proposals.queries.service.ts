import { db } from "../../../database/client.js";
import {
  countAgencyMembers,
  findAgencyOwnerLocation,
  listAgencyProposals,
  listClientJobProposalRows,
  listFreelancerProposals,
  listProposalStatusesBySender,
  countProposalStatusesBySender,
} from "../repositories/proposals.repository.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";
import { clerk } from "../../../infrastructure/auth/clerk.client.js";

const ACTIVE_PROPOSAL_STATUSES = new Set([
  "SUBMITTED",
  "VIEWED",
  "INTERVIEWED",
  "HIRED",
]);

interface Page {
  limit: number;
  offset: number;
}

const summarizeStatuses = (rows: { status: string; total: number }[]) => {
  const counts = { total: 0, active: 0, viewed: 0, interviewed: 0 };
  for (const row of rows) {
    const status = row.status.toUpperCase();
    counts.total += row.total;
    if (ACTIVE_PROPOSAL_STATUSES.has(status)) counts.active += row.total;
    if (status === "VIEWED") counts.viewed += row.total;
    if (status === "INTERVIEWED") counts.interviewed += row.total;
  }
  return counts;
};

const proposalMetadata = async (
  senderId: string,
  senderType: "FREELANCER" | "AGENCY",
  { limit, offset }: Page,
) => {
  const [page, statusCounts] = await Promise.all([
    listProposalStatusesBySender(db, senderId, senderType, {
      limit: fetchSize(limit),
      offset,
    }),
    countProposalStatusesBySender(db, senderId, senderType),
  ]);
  const { rows, hasMore } = toOffsetPage(page, limit);

  return {
    results: rows.map((proposal) => ({
      ...proposal,
      status: proposal.status.toUpperCase(),
    })),
    hasMore,
    counts: summarizeStatuses(statusCounts),
  };
};

export const getFreelancerProposalMetadata = (
  freelancerId: string,
  page: Page,
) => proposalMetadata(freelancerId, "FREELANCER", page);

export const getAgencyProposalMetadata = (agencyId: string, page: Page) =>
  proposalMetadata(agencyId, "AGENCY", page);

export const getFreelancerProposals = async (
  freelancerId: string,
  { limit, offset }: Page,
) => {
  const { rows, hasMore } = toOffsetPage(
    await listFreelancerProposals(db, freelancerId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  return { results: rows, hasMore };
};

export const getAgencyProposals = async (
  agencyId: string,
  { limit, offset }: Page,
) => {
  const { rows, hasMore } = toOffsetPage(
    await listAgencyProposals(db, agencyId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );

  return {
    results: rows.map((row) => ({
      ...row,
      clientRating: row.clientRating === null ? null : Number(row.clientRating),
    })),
    hasMore,
  };
};

export const getClientJobProposals = async (
  clientId: string,
  jobId: string,
  { limit, offset }: Page,
) => {
  const { rows, hasMore } = toOffsetPage(
    await listClientJobProposalRows(db, clientId, jobId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );

  const results = await Promise.all(
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
  return { results, hasMore };
};
