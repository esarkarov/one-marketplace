export interface ValidationAllowlistEntry {
  method: string;
  path: string;
  reason: string;
}

export const validationAllowlist: readonly ValidationAllowlistEntry[] = [
  {
    method: "POST",
    path: "/connects/webhook",
    reason: "raw body + Stripe signature, event typed by the Stripe SDK",
  },
  {
    method: "POST",
    path: "/contracts/webhook",
    reason: "raw body + Stripe signature, event typed by the Stripe SDK",
  },
  {
    method: "POST",
    path: "/identity/webhook",
    reason: "raw body + Stripe signature, event typed by the Stripe SDK",
  },
  {
    method: "POST",
    path: "/meetings/webhook",
    reason: "raw body + Daily HMAC signature, parsed in the controller",
  },
];

export const bodylessRoutes: readonly ValidationAllowlistEntry[] = [
  {
    method: "POST",
    path: "/jobs/saved/:jobId",
    reason: "saves a job from the path param; no body is read",
  },
  {
    method: "PATCH",
    path: "/notifications/read-all",
    reason: "marks all notifications read; no body is read",
  },
  {
    method: "PATCH",
    path: "/notifications/:notificationId/read",
    reason: "marks one notification read; no body is read",
  },
  {
    method: "POST",
    path: "/conversations/:conversationId/meetings",
    reason: "creates a meeting from the path param; no body is read",
  },
  {
    method: "PATCH",
    path: "/contracts/:contractId/accept",
    reason: "accepts the offer from the path param; no body is read",
  },
  {
    method: "POST",
    path: "/identity/session",
    reason: "starts an identity session from the account; no body is read",
  },
  {
    method: "POST",
    path: "/agency/team/invitations/:invitationId/resend",
    reason: "resends from the path param; no body is read",
  },
];

export const publicRoutes: readonly ValidationAllowlistEntry[] = [
  {
    method: "GET",
    path: "/freelancer/profile/:id",
    reason: "public freelancer profile, no authentication",
  },
  {
    method: "GET",
    path: "/jobs/public",
    reason: "public jobs feed, no authentication",
  },
  {
    method: "GET",
    path: "/agency/profile/:id",
    reason: "public agency profile, no authentication",
  },
  {
    method: "GET",
    path: "/health",
    reason: "liveness probe, no authentication",
  },
  {
    method: "GET",
    path: "/ready",
    reason: "readiness probe, no authentication",
  },
];
