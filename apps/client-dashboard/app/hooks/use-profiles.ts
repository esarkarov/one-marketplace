"use client";

import { unwrap } from "@onemarketplace/api-client";
import { useApi, useApiConfig } from "@onemarketplace/web-core";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  MARKETPLACE_PAGE_SIZE,
  nextMarketplaceOffset,
  type AccountFilter,
} from "@/lib/profiles";

export const useTalentProfile = (id: string) => {
  const api = useApi();
  return useQuery({
    queryKey: ["client-talent-profile", id],
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/freelancer/profile/{id}", {
          params: { path: { id } },
        }),
      ),
  });
};

export const useAgencyProfile = (id: string) => {
  const api = useApi();
  return useQuery({
    queryKey: ["client-agency-profile", id],
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/agency/profile/{id}", {
          params: { path: { id } },
        }),
      ),
  });
};

export const useDashboardOverview = (enabled: boolean) => {
  const api = useApi();
  return useQuery({
    queryKey: ["client-dashboard-overview"],
    enabled,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/client/dashboard-overview", {
          params: { query: {} },
        }),
      ),
  });
};

export const useMarketplaceSearch = (
  query: string,
  type: AccountFilter,
  enabled: boolean,
) => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  return useInfiniteQuery({
    queryKey: ["client-marketplace-search", role, scope, query, type],
    enabled,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/client/marketplace/search", {
          params: {
            query: {
              query,
              type,
              limit: MARKETPLACE_PAGE_SIZE,
              offset: pageParam,
            },
          },
        }),
      ),
    getNextPageParam: nextMarketplaceOffset,
  });
};
