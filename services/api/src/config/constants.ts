import { ApiError } from "../utils/api-error.js";

export const API_PREFIX = "/api/v1";
export const SERVICE_NAME = "onemarketplace-services";

export const ACCOUNT_AUTH_CACHE_TTL_SECONDS = 10 * 60;
export const ACCOUNT_AUTH_NEGATIVE_CACHE_TTL_SECONDS = 30;
export const getAccountAuthCacheKey = (
  userId: string,
  role: "client" | "freelancer",
): string => `account:auth:${userId}:${role}`;
export const getAccountAuthCacheKeys = (userId: string): string[] => [
  getAccountAuthCacheKey(userId, "client"),
  getAccountAuthCacheKey(userId, "freelancer"),
];

export const requireText = (
  value: string | undefined | string[],
  fieldName: string,
): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${fieldName} is required.`);
  }

  return value.trim();
};

export const requireWebsite = (value: string | undefined): string => {
  const website = requireText(value, "Company website");

  try {
    const url = new URL(website);

    if (url.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }
  } catch {
    throw new ApiError(400, "Company website must be a valid HTTP URL.");
  }

  return website;
};

export const INITIAL_CONNECTS = 60;
export const PROPOSAL_CONNECTS = 6;

export const CONNECTS_CACHE_TTL_SECONDS = 10 * 60;

export const getConnectsCacheKey = (userId: string): string =>
  `connects:${userId}:freelancer`;

export const getAgencyConnectsCacheKey = (agencyId: string): string =>
  `connects:${agencyId}:agency`;

export const CONNECTS_PLANS = {
  20: 300,
  40: 600,
  80: 1200,
} as const;

export type ConnectsPlan = keyof typeof CONNECTS_PLANS;
export const PLATFORM_FEE_BPS = 1000;

export const EARNINGS_HOLD_PERIOD_DAYS = 5;
export const EARNINGS_HOLD_PERIOD_MS =
  EARNINGS_HOLD_PERIOD_DAYS * 24 * 60 * 60 * 1000;

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
