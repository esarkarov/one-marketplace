export interface ContractAllowlistEntry {
  method: string;
  path: string;
  reason: string;
}

export interface ContractAllowlist {
  rawBodyWebhooks: readonly ContractAllowlistEntry[];
  eventStreams: readonly ContractAllowlistEntry[];
  untestedRoutes: readonly ContractAllowlistEntry[];
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
