import type { Components } from "@onemarketplace/api-client";
import {
  ApiError,
  dollarsToCents,
  errorMessage,
  formatCents,
  formatDate,
  isApiError,
} from "@onemarketplace/api-client";
import { validateMilestoneAmount } from "./jobs";
import { isHttpsUrl } from "./url";

export type ContractItem = Components["schemas"]["ContractsContract"];
export type MilestoneItem = ContractItem["milestones"][number];
export type ContractStatus = ContractItem["status"];
export type MilestoneStatus = MilestoneItem["status"];

export const CONTRACTS_PAGE_SIZE = 20;

export const ADD_MILESTONE_MIN_CENTS = 1000;
export const ADD_MILESTONE_MAX_CENTS = 100_000_000;

export const MILESTONE_TITLE_MIN = 3;
export const MILESTONE_TITLE_MAX = 120;
export const REQUIREMENTS_MAX = 500;
export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 5000;
export const REVIEW_COMMENT_MIN = 10;
export const REVIEW_COMMENT_MAX = 1000;

export const INVALID_CHECKOUT_MESSAGE = "Checkout returned an invalid address.";

export class InvalidCheckoutUrlError extends Error {
  constructor() {
    super(INVALID_CHECKOUT_MESSAGE);
    this.name = "InvalidCheckoutUrlError";
  }
}

const KNOWN_CONTRACT_LABELS = {
  PENDING: "Awaiting approval",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
} satisfies Record<ContractStatus, string>;

const CONTRACT_LABELS: Readonly<Record<string, string>> = KNOWN_CONTRACT_LABELS;

export const contractStatusLabel = (status: string): string =>
  Object.hasOwn(CONTRACT_LABELS, status)
    ? (CONTRACT_LABELS[status] ?? status)
    : status;

export type ContractTone =
  "pending" | "active" | "completed" | "cancelled" | "unknown";

export const contractStatusTone = (status: string): ContractTone => {
  switch (status) {
    case "PENDING":
      return "pending";
    case "ACTIVE":
      return "active";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
};

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

const MILESTONE_STATE_LABELS: Readonly<
  Record<Exclude<MilestoneState, "UNKNOWN">, string>
> = {
  PAID: "Paid",
  SUBMITTED: "Submitted",
  IN_PROGRESS: "In progress",
  UPCOMING: "Upcoming",
};

export const milestoneLabel = (
  milestone: Pick<MilestoneItem, "status" | "paymentRequestedAt">,
): string => {
  const state = milestoneState(milestone);
  return state === "UNKNOWN" ? milestone.status : MILESTONE_STATE_LABELS[state];
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

export const formatDueDate = (value: string | null | undefined): string =>
  formatDate(value);

export const counterpartyLabel = (type: string): string => {
  switch (type) {
    case "FREELANCER":
      return "Freelancer";
    case "AGENCY":
      return "Agency";
    case "CLIENT":
      return "Client";
    default:
      return type;
  }
};

export const startedAt = (
  contract: Pick<ContractItem, "startedAt" | "createdAt">,
): string => contract.startedAt ?? contract.createdAt;

export const canFundMilestone = (
  contract: Pick<ContractItem, "status" | "milestones">,
  index: number,
): boolean => {
  if (contract.status !== "ACTIVE") return false;
  const target = contract.milestones[index];
  if (!target || milestoneState(target) !== "UPCOMING") return false;
  if (
    !contract.milestones
      .slice(0, index)
      .every((previous) => milestoneState(previous) === "PAID")
  ) {
    return false;
  }
  return !contract.milestones.some((item) => {
    const state = milestoneState(item);
    return state === "IN_PROGRESS" || state === "SUBMITTED";
  });
};

export const canReviewMilestone = (
  contract: Pick<ContractItem, "status">,
  milestone: Pick<MilestoneItem, "status" | "paymentRequestedAt">,
): boolean =>
  contract.status === "ACTIVE" && milestoneState(milestone) === "SUBMITTED";

export const canFinishContract = (
  contract: Pick<ContractItem, "status" | "milestones">,
): boolean =>
  contract.status === "ACTIVE" &&
  contract.milestones.every(
    (milestone) => milestoneState(milestone) === "PAID",
  );

export const canAddMilestone = canFinishContract;

export const canWithdrawContract = (
  contract: Pick<ContractItem, "status">,
): boolean => contract.status === "PENDING";

export const canGiveReview = (
  contract: Pick<ContractItem, "status" | "reviewedByCurrentUser">,
): boolean =>
  contract.status === "COMPLETED" && !contract.reviewedByCurrentUser;

export const findContract = (
  contracts: readonly ContractItem[],
  contractId: string | null,
): ContractItem | null =>
  contractId
    ? (contracts.find((contract) => contract.id === contractId) ?? null)
    : null;

export const hasActiveContract = (
  contracts: readonly Pick<ContractItem, "status">[],
): boolean => contracts.some((contract) => contract.status === "ACTIVE");

export const messagesLink = (
  conversationId: string | null | undefined,
): string | null =>
  conversationId
    ? `/messages?conversationId=${encodeURIComponent(conversationId)}`
    : null;

export const contractHref = (contractId: string): string =>
  `/contracts?contractId=${encodeURIComponent(contractId)}`;

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

export const isContractConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409;

export interface AddMilestoneInput {
  title: string;
  amount: string;
  dueDate: string;
}

export interface AddMilestoneBody {
  title: string;
  amountCents: number;
  dueDate: string;
}

export type Validated<T> =
  { ok: true; value: T } | { ok: false; message: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const validateAddMilestone = (
  input: AddMilestoneInput,
  today: string,
): Validated<AddMilestoneBody> => {
  const title = input.title.trim();
  if (
    title.length < MILESTONE_TITLE_MIN ||
    title.length > MILESTONE_TITLE_MAX
  ) {
    return {
      ok: false,
      message: `Title must be ${MILESTONE_TITLE_MIN} to ${MILESTONE_TITLE_MAX} characters.`,
    };
  }
  const amountMessage = validateMilestoneAmount(input.amount.trim(), {
    minCents: ADD_MILESTONE_MIN_CENTS,
    maxCents: ADD_MILESTONE_MAX_CENTS,
  });
  if (amountMessage) return { ok: false, message: amountMessage };
  const amountCents = dollarsToCents(input.amount.trim());
  if (!DATE_ONLY.test(input.dueDate)) {
    return { ok: false, message: "Choose a due date." };
  }
  if (input.dueDate < today) {
    return { ok: false, message: "The due date cannot be in the past." };
  }
  return { ok: true, value: { title, amountCents, dueDate: input.dueDate } };
};

export const validateFeedback = (value: string): Validated<string> => {
  const feedback = value.trim();
  if (feedback.length < FEEDBACK_MIN) {
    return {
      ok: false,
      message: `Please describe the requested update in at least ${FEEDBACK_MIN} characters.`,
    };
  }
  if (feedback.length > FEEDBACK_MAX) {
    return {
      ok: false,
      message: `Feedback must be at most ${FEEDBACK_MAX} characters.`,
    };
  }
  return { ok: true, value: feedback };
};

export const validateRequirements = (
  value: string,
): Validated<string | undefined> => {
  const requirements = value.trim();
  if (requirements.length > REQUIREMENTS_MAX) {
    return {
      ok: false,
      message: `Requirements must be at most ${REQUIREMENTS_MAX} characters.`,
    };
  }
  return { ok: true, value: requirements || undefined };
};

export const validateContractReview = (input: {
  rating: number;
  comment: string;
}): Validated<{ rating: number; comment: string }> => {
  const comment = input.comment.trim();
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, message: "Choose a rating from 1 to 5." };
  }
  if (comment.length < REVIEW_COMMENT_MIN) {
    return {
      ok: false,
      message: `The review must be at least ${REVIEW_COMMENT_MIN} characters.`,
    };
  }
  if (comment.length > REVIEW_COMMENT_MAX) {
    return {
      ok: false,
      message: `The review must be at most ${REVIEW_COMMENT_MAX} characters.`,
    };
  }
  return { ok: true, value: { rating: input.rating, comment } };
};

export const todayLocalDate = (now: Date = new Date()): string =>
  [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

export const MILESTONE_AMOUNT_HINT = `At least ${formatCents(ADD_MILESTONE_MIN_CENTS)}`;
