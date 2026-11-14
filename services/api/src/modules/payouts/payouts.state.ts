export const PAYOUT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const STUCK_CLAIM_MINUTES = 15;

export const ALLOWED_TRANSITIONS: Readonly<
  Record<PayoutStatus, readonly PayoutStatus[]>
> = {
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["PROCESSING", "PAID", "FAILED"],
  FAILED: ["PROCESSING"],
  PAID: [],
};

export class PayoutTransitionError extends Error {
  readonly from: PayoutStatus;
  readonly to: PayoutStatus;

  constructor(from: PayoutStatus, to: PayoutStatus) {
    super(`Payout transition ${from} -> ${to} is not allowed`);
    this.name = "PayoutTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const isTransitionAllowed = (
  from: PayoutStatus,
  to: PayoutStatus,
): boolean => ALLOWED_TRANSITIONS[from].includes(to);

export const assertTransition = (
  from: PayoutStatus,
  to: PayoutStatus,
): void => {
  if (!isTransitionAllowed(from, to)) {
    throw new PayoutTransitionError(from, to);
  }
};

export const allowedFrom = (to: PayoutStatus): PayoutStatus[] =>
  PAYOUT_STATUSES.filter((from) => isTransitionAllowed(from, to));

export const requireAllowedFrom = (to: PayoutStatus): PayoutStatus[] => {
  const froms = allowedFrom(to);
  if (froms.length === 0) {
    throw new Error(`No payout transition leads to ${to}`);
  }
  return froms;
};
