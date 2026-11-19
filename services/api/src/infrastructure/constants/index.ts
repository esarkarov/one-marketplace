export const DAILY_API_BASE = "https://api.daily.co/v1";
export const ROOM_TTL_SECONDS = 60 * 60 * 6;
export const STRIPE_TIMEOUT_MS = 30_000;
export const PUBLISH_TIMEOUT_MS = 2_000;
export const NOTIFICATIONS_CREATED_ROUTING_KEY = "notifications.created";
export const NOTIFICATION_CREATED_TYPE = NOTIFICATIONS_CREATED_ROUTING_KEY;
export const DEFAULT_DELIVERY_LIMIT = 5;

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
