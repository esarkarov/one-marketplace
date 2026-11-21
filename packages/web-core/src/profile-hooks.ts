import { unwrap } from "@onemarketplace/api-client";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "./provider";
import { queryKeys } from "./query-keys";

export const useTalentProfile = (id: string) => {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.publicProfile("talent", id),
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
    queryKey: queryKeys.publicProfile("agency", id),
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/agency/profile/{id}", {
          params: { path: { id } },
        }),
      ),
  });
};
