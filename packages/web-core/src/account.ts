import { unwrap } from "@onemarketplace/api-client";
import type { Role, Scope } from "@onemarketplace/api-client";
import { useQuery } from "@tanstack/react-query";
import { useApi, useApiConfig } from "./provider";
import { queryKeys } from "./query-keys";

export const ACCOUNT_STALE_TIME_MS = 30 * 60_000;

export type AccountStatus = "loading" | "ready" | "error";

export interface Account {
  status: AccountStatus;
  accountId: string | null;
  agencyId: string | null;
  role: Role;
  scope: Scope | undefined;
  /**
   * The id that identifies me as a message sender and a typing user: always
   * the public account id, in every scope (the API stores the sender per
   * account, never per agency).
   */
  actorId: string | null;
  /**
   * The id that identifies me in `presence:*` events: the agency id in agency
   * scope, the account id otherwise.
   */
  presenceId: string | null;
  isMine: (senderId: string | null | undefined) => boolean;
  refetch: () => Promise<unknown>;
}

export const useAccount = (): Account => {
  const api = useApi();
  const { role, scope } = useApiConfig();

  const auth = useQuery({
    queryKey: queryKeys.auth(role, scope),
    queryFn: () =>
      unwrap(api.GET("/api/v1/auth/status", { params: { query: {} } })),
    staleTime: ACCOUNT_STALE_TIME_MS,
  });

  const wantsAgency = scope === "agency";
  const membership = useQuery({
    queryKey: queryKeys.agencyMembership(role, scope),
    queryFn: () =>
      unwrap(api.GET("/api/v1/agency/membership", { params: { query: {} } })),
    staleTime: ACCOUNT_STALE_TIME_MS,
    enabled: wantsAgency,
  });

  const accountId = auth.data?.accountId ?? null;
  const agencyId = wantsAgency ? (membership.data?.agencyId ?? null) : null;

  let status: AccountStatus = "ready";
  if (auth.isError || (wantsAgency && membership.isError)) status = "error";
  else if (auth.isPending || (wantsAgency && membership.isPending)) {
    status = "loading";
  }

  const actorId = accountId;
  const presenceId = wantsAgency ? agencyId : accountId;

  return {
    status,
    accountId,
    agencyId,
    role,
    scope,
    actorId,
    presenceId,
    isMine: (senderId) =>
      actorId !== null && senderId !== null && senderId === actorId,
    refetch: () =>
      Promise.all([auth.refetch(), wantsAgency ? membership.refetch() : null]),
  };
};
