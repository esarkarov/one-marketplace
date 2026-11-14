import type { ValidationAllowlistEntry } from "./validation-allowlist.js";

export interface ContractAllowlist {
  rawBodyWebhooks: readonly ValidationAllowlistEntry[];
  eventStreams: readonly ValidationAllowlistEntry[];
  untestedRoutes: readonly ValidationAllowlistEntry[];
}

export const contractAllowlist: ContractAllowlist = {
  rawBodyWebhooks: [
    {
      method: "POST",
      path: "/connects/webhook",
      reason:
        "raw body + Stripe signature; documented as 200 on success and 400 on a bad signature only",
    },
    {
      method: "POST",
      path: "/contracts/webhook",
      reason:
        "raw body + Stripe signature; documented as 200 on success and 400 on a bad signature only",
    },
    {
      method: "POST",
      path: "/identity/webhook",
      reason:
        "raw body + Stripe signature; documented as 200 on success and 400 on a bad signature only",
    },
    {
      method: "POST",
      path: "/meetings/webhook",
      reason:
        "raw body + Daily HMAC signature; documented as 200 on success and 400 on a bad signature only",
    },
  ],
  eventStreams: [
    {
      method: "GET",
      path: "/notifications/stream",
      reason: "text/event-stream; documented as a stream with no item schema",
    },
    {
      method: "GET",
      path: "/admin/logs/stream",
      reason: "text/event-stream; documented as a stream with no item schema",
    },
  ],
  untestedRoutes: [],
};
