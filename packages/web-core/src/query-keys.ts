import type { Role, Scope } from "@onemarketplace/api-client";

export interface PageParams {
  limit?: number;
  offset?: number;
}

const base = ["web-core"] as const;
const scoped = (role: Role, scope: Scope | undefined) =>
  [role, scope ?? "default"] as const;

/**
 * Every web-core query key is `["web-core", <domain>, role, scope, ...rest]`.
 * Role and scope are always part of the key, so a role or scope change never
 * reads another audience's cache. Invalidate a whole domain with the matching
 * prefix helper (`notificationsAll`, `conversationsAll`); the leaf keys carry
 * the request parameters.
 */
export const queryKeys = {
  root: base,
  auth: (role: Role, scope?: Scope) =>
    [...base, "auth", ...scoped(role, scope), "status"] as const,
  agencyMembership: (role: Role, scope?: Scope) =>
    [...base, "auth", ...scoped(role, scope), "agency"] as const,
  notificationsAll: (role: Role, scope?: Scope) =>
    [...base, "notifications", ...scoped(role, scope)] as const,
  notifications: (role: Role, scope: Scope | undefined, params: PageParams) =>
    [
      ...base,
      "notifications",
      ...scoped(role, scope),
      "list",
      { limit: params.limit ?? 20, offset: params.offset ?? 0 },
    ] as const,
  notificationsUnread: (role: Role, scope?: Scope) =>
    [...base, "notifications", ...scoped(role, scope), "unread"] as const,
  conversationsAll: (role: Role, scope?: Scope) =>
    [...base, "conversations", ...scoped(role, scope)] as const,
  conversations: (role: Role, scope: Scope | undefined, params: PageParams) =>
    [
      ...base,
      "conversations",
      ...scoped(role, scope),
      "list",
      { limit: params.limit ?? 20, offset: params.offset ?? 0 },
    ] as const,
  conversationMessages: (
    role: Role,
    scope: Scope | undefined,
    conversationId: string,
  ) =>
    [
      ...base,
      "conversations",
      ...scoped(role, scope),
      "messages",
      conversationId,
    ] as const,
};
