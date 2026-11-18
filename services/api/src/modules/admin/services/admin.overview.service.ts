import { db } from "../../../database/client.js";
import { toSafeCents } from "../../../shared/money/money.js";
import {
  countAccountsByRole,
  countActiveContracts,
  countAgencies,
  countContracts,
  countJobPosts,
  countProposals,
  listRecentAccounts,
  listRecentAgencies,
  listRecentContracts,
  listRecentJobPosts,
  sumCompletedConnectsPurchaseCents,
  sumContractTotalCents,
  sumPaidPayoutCents,
} from "../repositories/admin.repository.js";
import { Pagination } from "../types/admin.types.js";
import { fetchSize } from "../../../shared/validation/utils/pagination.utils.js";
import { mergePages } from "../utils/admin.pagination.js";

export const getAdminOverviewTotals = async () => {
  const [
    [freelancerCount],
    [clientCount],
    [agencyCount],
    [jobPostCount],
    [proposalCount],
    [contractCount],
    [activeContractCount],
    [contractVolume],
    [payoutVolume],
    [connectsRevenue],
  ] = await Promise.all([
    countAccountsByRole(db, "FREELANCER"),
    countAccountsByRole(db, "CLIENT"),
    countAgencies(db),
    countJobPosts(db),
    countProposals(db),
    countContracts(db),
    countActiveContracts(db),
    sumContractTotalCents(db),
    sumPaidPayoutCents(db),
    sumCompletedConnectsPurchaseCents(db),
  ]);

  return {
    totals: {
      freelancers: Number(freelancerCount?.value ?? 0),
      clients: Number(clientCount?.value ?? 0),
      agencies: Number(agencyCount?.value ?? 0),
      jobPosts: Number(jobPostCount?.value ?? 0),
      proposals: Number(proposalCount?.value ?? 0),
      contracts: Number(contractCount?.value ?? 0),
      activeContracts: Number(activeContractCount?.value ?? 0),
    },
    volume: {
      totalContractValueCents: toSafeCents(contractVolume?.value),
      totalPaidOutCents: toSafeCents(payoutVolume?.value),
      totalConnectsRevenueCents: toSafeCents(connectsRevenue?.value),
    },
  };
};

export const getAdminOverviewActivity = async (pagination: Pagination) => {
  const fetchLimit = pagination.offset + fetchSize(pagination.limit);

  const [recentAccounts, recentAgencies, recentJobs, recentContracts] =
    await Promise.all([
      listRecentAccounts(db, fetchLimit),
      listRecentAgencies(db, fetchLimit),
      listRecentJobPosts(db, fetchLimit),
      listRecentContracts(db, fetchLimit),
    ]);

  return mergePages(
    [
      recentAccounts.map((row) => ({
        type: row.role === "FREELANCER" ? "Freelancer joined" : "Client joined",
        id: row.id,
        title:
          row.role === "FREELANCER"
            ? "New freelancer account"
            : "New client account",
        createdAt: row.createdAt,
      })),
      recentAgencies.map((row) => ({
        type: "Agency created",
        id: row.id,
        title: row.name,
        createdAt: row.createdAt,
      })),
      recentJobs.map((row) => ({
        type: "Job posted",
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      })),
      recentContracts.map((row) => ({
        type: "Contract created",
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      })),
    ],
    pagination,
  );
};
