import { formatCents, type Components } from "@onemarketplace/api-client";

type Schemas = Components["schemas"];

export function overviewVolumeView(volume: {
  totalContractValueCents: number;
  totalPaidOutCents: number;
  totalConnectsRevenueCents: number;
}) {
  return {
    totalContractValue: formatCents(volume.totalContractValueCents),
    totalPaidOut: formatCents(volume.totalPaidOutCents),
    connectsRevenue: formatCents(volume.totalConnectsRevenueCents),
  };
}

export function jobPostMoneyView(job: Schemas["AdminJobPostItem"]) {
  return {
    totalBudget: formatCents(job.totalBudgetCents),
    milestones: job.milestones.map((milestone) => ({
      id: milestone.id,
      budget: formatCents(milestone.budgetCents),
    })),
  };
}

export function proposalMoneyView(proposal: Schemas["AdminProposalItem"]) {
  return {
    bid: formatCents(proposal.bidAmountCents),
    jobBudget: formatCents(proposal.jobBudgetCents),
  };
}

export function contractMoneyView(contract: Schemas["AdminContractItem"]) {
  return {
    total: formatCents(contract.totalAmountCents),
    milestones: contract.milestones.map((milestone) => ({
      id: milestone.id,
      amount: formatCents(milestone.amountCents),
    })),
  };
}

export function transactionAmountView(
  transaction: Schemas["AdminTransactionItem"],
) {
  return formatCents(transaction.amountCents);
}
