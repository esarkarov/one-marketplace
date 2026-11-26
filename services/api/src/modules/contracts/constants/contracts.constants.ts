import { STRIPE_PERMANENT_REFUND_ERROR_CODES } from "@/infrastructure/constants/payments.constants.js";

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
  permanentErrorCodes: STRIPE_PERMANENT_REFUND_ERROR_CODES,
} as const;

export const ORPHAN_PAYMENT_DETECTION = {
  lookbackMs: 4 * 24 * HOUR_MS,
  minAgeMs: 2 * HOUR_MS,
  retriesExhaustedAgeMs: 3 * 24 * HOUR_MS,
  pageSize: 100,
  defaultMaxPages: 20,
} as const;
