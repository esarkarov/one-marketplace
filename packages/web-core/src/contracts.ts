import type { Components } from "@onemarketplace/api-client";
import { errorMessage, isApiError } from "@onemarketplace/api-client";
import { isHttpsUrl } from "./url";

export type ContractItem = Components["schemas"]["ContractsContract"];
export type MilestoneItem = ContractItem["milestones"][number];
export type ContractStatus = ContractItem["status"];
export type MilestoneStatus = MilestoneItem["status"];

export const INVALID_CHECKOUT_MESSAGE = "Checkout returned an invalid address.";

export class InvalidCheckoutUrlError extends Error {
  constructor() {
    super(INVALID_CHECKOUT_MESSAGE);
    this.name = "InvalidCheckoutUrlError";
  }
}

export type MilestoneState =
  "PAID" | "SUBMITTED" | "IN_PROGRESS" | "UPCOMING" | "UNKNOWN";

const KNOWN_MILESTONE_STATUSES: readonly string[] = [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
] satisfies readonly MilestoneStatus[];

export const milestoneState = (
  milestone: Pick<MilestoneItem, "status" | "paymentRequestedAt">,
): MilestoneState => {
  if (!KNOWN_MILESTONE_STATUSES.includes(milestone.status)) return "UNKNOWN";
  if (milestone.status === "COMPLETED") return "PAID";
  if (milestone.status === "ACTIVE") {
    return milestone.paymentRequestedAt ? "SUBMITTED" : "IN_PROGRESS";
  }
  return "UPCOMING";
};

export interface ContractTotals {
  totalCents: number;
  paidCents: number;
  escrowCents: number;
  progressPercent: number;
}

export const contractTotals = (
  contract: Pick<ContractItem, "totalAmountCents" | "milestones">,
): ContractTotals => {
  let paidCents = 0;
  let escrowCents = 0;
  for (const milestone of contract.milestones) {
    if (milestone.status === "COMPLETED") paidCents += milestone.amountCents;
    else if (milestone.fundedAt) escrowCents += milestone.amountCents;
  }
  const totalCents = contract.totalAmountCents;
  const progressPercent =
    totalCents > 0
      ? Math.min(100, Math.max(0, Math.round((paidCents * 100) / totalCents)))
      : 0;
  return { totalCents, paidCents, escrowCents, progressPercent };
};

export const sumContractTotals = (
  contracts: readonly ContractItem[],
): { escrowCents: number; paidCents: number; activeCount: number } => {
  let escrowCents = 0;
  let paidCents = 0;
  let activeCount = 0;
  for (const contract of contracts) {
    if (contract.status === "CANCELLED") continue;
    const totals = contractTotals(contract);
    escrowCents += totals.escrowCents;
    paidCents += totals.paidCents;
    if (contract.status === "ACTIVE") activeCount += 1;
  }
  return { escrowCents, paidCents, activeCount };
};

export const nextDeadline = (
  contract: Pick<ContractItem, "status" | "milestones">,
): string | null => {
  if (contract.status !== "ACTIVE" && contract.status !== "PENDING") {
    return null;
  }
  const next = contract.milestones.find(
    (milestone) => milestone.status !== "COMPLETED",
  );
  return next ? next.dueDate : null;
};

export const startedAt = (
  contract: Pick<ContractItem, "startedAt" | "createdAt">,
): string => contract.startedAt ?? contract.createdAt;

export const safeCheckoutUrl = (value: string): string | null =>
  isHttpsUrl(value) ? value : null;

export const contractErrorMessage = (error: unknown): string => {
  if (error instanceof InvalidCheckoutUrlError) return error.message;
  const message = errorMessage(error);
  return isApiError(error) && error.requestId
    ? `${message} (reference ${error.requestId})`
    : message;
};

export const contractErrorMessageOf = (error: unknown): string =>
  error ? contractErrorMessage(error) : "";
