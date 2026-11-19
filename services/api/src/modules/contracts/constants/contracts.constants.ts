export const CONTRACT_LIMITS = {
  milestoneRequirementsMax: 500,
  milestoneTitleMin: 3,
  milestoneTitleMax: 120,
  reviewCommentMin: 10,
  reviewCommentMax: 1000,
  ratingMin: 1,
  ratingMax: 5,
  submissionMessageMin: 10,
  submissionMessageMax: 5000,
  feedbackMax: 5000,
  submissionDeliveryLinkMax: 2048,
} as const;

export const COUNTERPARTY_TYPES = ["CLIENT", "FREELANCER", "AGENCY"] as const;

export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const REFUND_RECONCILIATION = {
  maxAttempts: 20,
  defaultLimit: 50,
  minCancelledAgeMs: 5 * MINUTE_MS,
  leaseMs: 10 * MINUTE_MS,
  baseBackoffMs: 15 * MINUTE_MS,
  maxBackoffMs: 24 * HOUR_MS,
  originalKeyWindowMs: 23 * HOUR_MS,
  maxConsecutiveUnavailable: 3,
  lastErrorMaxLength: 200,
  permanentErrorCodes: [
    "charge_not_refundable",
    "refund_disputed_payment",
    "resource_missing",
  ],
} as const;
