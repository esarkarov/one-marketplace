"use client";

import { isApiError, unwrap } from "@onemarketplace/api-client";
import { queryKeys, useApi, useApiConfig } from "@onemarketplace/web-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  mergeSavedProfile,
  PROFILE_NOT_FOUND_CODE,
  type ClientProfile,
  type ClientProfileBody,
} from "@/lib/client-profile";

export const CLIENT_PROFILE_QUERY_KEY = ["profile-metadata"] as const;
export const COMPLETED_CONTRACTS_LIMIT = 50;

export const useClientProfile = (enabled = true) => {
  const api = useApi();
  return useQuery<ClientProfile | null>({
    queryKey: CLIENT_PROFILE_QUERY_KEY,
    enabled,
    queryFn: async () => {
      try {
        return await unwrap(
          api.GET("/api/v1/client/profile", { params: { query: {} } }),
        );
      } catch (error) {
        if (isApiError(error) && error.code === PROFILE_NOT_FOUND_CODE) {
          return null;
        }
        throw error;
      }
    },
  });
};

export const useSaveClientProfile = () => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ClientProfileBody) =>
      unwrap(
        api.PUT("/api/v1/client/profile", { params: { query: {} }, body }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData<ClientProfile | null>(
        CLIENT_PROFILE_QUERY_KEY,
        (current) => mergeSavedProfile(current, saved),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth(role, scope),
      });
    },
  });
};

export const useClientHiringOverview = () => {
  const api = useApi();
  return useQuery({
    queryKey: ["client-hiring-overview"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/client/hiring-overview", { params: { query: {} } }),
      ),
  });
};

export const useClientCompletedContracts = () => {
  const api = useApi();
  return useQuery({
    queryKey: ["client-completed-contracts"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/client/completed-contracts", {
          params: { query: { limit: COMPLETED_CONTRACTS_LIMIT } },
        }),
      ),
  });
};

export const useStripeManageLink = () => {
  const api = useApi();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.GET("/api/v1/client/finances/manage-link", {
          params: { query: {} },
        }),
      ),
  });
};

export const useStartIdentityVerification = () => {
  const api = useApi();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/identity/session", { params: { query: {} } })),
  });
};
