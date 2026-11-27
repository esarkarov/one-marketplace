import type { ExternalPolicy } from "@/infrastructure/types/external-call.types.js";

export const DAILY_API_BASE = "https://api.daily.co/v1";
export const ROOM_TTL_SECONDS = 60 * 60 * 6;
export const ROOM_TOKEN_EXPIRY_MARGIN_SECONDS = 300;
export const DAILY_TIMEOUT_MS = 8_000;
export const EXTERNAL_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503, 504,
]);
export const EXTERNAL_RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);
export const EXTERNAL_RETRYABLE_NETWORK_CODE_PREFIX = "UND_ERR_";
export const EXTERNAL_MIN_ATTEMPT_MS = 100;

export const EXTERNAL_POLICIES = {
  "daily.createRoom": {
    target: "daily",
    operation: "createRoom",
    timeoutMs: DAILY_TIMEOUT_MS,
    idempotent: false,
  },
  "daily.createToken": {
    target: "daily",
    operation: "createToken",
    timeoutMs: DAILY_TIMEOUT_MS,
    idempotent: true,
    retry: { max: 1, baseMs: 200, maxMs: 1_000, totalBudgetMs: 12_000 },
  },
  "clerk.signup.getUser": {
    target: "clerk",
    operation: "signup.getUser",
    timeoutMs: 5_000,
    idempotent: true,
    retry: { max: 2, baseMs: 300, maxMs: 600, totalBudgetMs: 10_000 },
  },
  "clerk.syncDisplay": {
    target: "clerk",
    operation: "syncDisplay",
    timeoutMs: 2_000,
    idempotent: true,
  },
} as const satisfies Record<string, ExternalPolicy>;
export const IMAGEKIT_TIMEOUT_MS = 30_000;
export const STRIPE_TIMEOUT_MS = 30_000;
export const PUBLISH_TIMEOUT_MS = 2_000;
export const NOTIFICATIONS_CREATED_ROUTING_KEY = "notifications.created";
export const NOTIFICATION_CREATED_TYPE = NOTIFICATIONS_CREATED_ROUTING_KEY;
export const DEFAULT_DELIVERY_LIMIT = 5;
export const DEAD_LETTER_CHECK_INTERVAL_MS = 60_000;
export const DEAD_LETTER_CHECK_FAILURE_LOG_INTERVAL_MS = 10 * 60_000;
export const DEAD_LETTER_NONEMPTY_LOG_INTERVAL_MS = 10 * 60_000;
export const DEAD_LETTER_STOP_TIMEOUT_MS = 2_000;
export const REDIS_RECONNECT_BASE_DELAY_MS = 100;
export const REDIS_RECONNECT_MAX_DELAY_MS = 5_000;
export const REDIS_RECONNECT_JITTER_MS = 100;
export const REDIS_CONNECT_TIMEOUT_MS = 5_000;
export const REDIS_STARTUP_DEADLINE_MS = 15_000;
export const REDIS_QUIT_TIMEOUT_MS = 2_000;
export const CACHE_COMMAND_TIMEOUT_MS = 300;
export const CACHE_DEGRADED_LOG_INTERVAL_MS = 60_000;

export const STRIPE_PAYOUT_ELIGIBLE_COUNTRIES = new Set([
  "US",
  "GB",
  "CA",
  "CH",
  // EEA: EU member states + Iceland, Liechtenstein, Norway
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
]);
