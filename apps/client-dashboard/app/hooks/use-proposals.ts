"use client";

import { unwrap } from "@onemarketplace/api-client";
import { useApi } from "@onemarketplace/web-core";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { JOBS_QUERY_KEY } from "@/app/hooks/use-jobs";
import { PROPOSALS_PAGE_SIZE, type ProposalListItem } from "@/lib/proposals";

export const PROPOSALS_QUERY_KEY = ["client-proposals"] as const;

export const jobProposalsKey = (jobId: string, limit: number, offset: number) =>
  [...PROPOSALS_QUERY_KEY, jobId, { limit, offset }] as const;

export const useJobProposals = (
  jobId: string,
  page: number,
  limit = PROPOSALS_PAGE_SIZE,
) => {
  const api = useApi();
  const offset = page * limit;
  return useQuery({
    queryKey: jobProposalsKey(jobId, limit, offset),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const data = await unwrap(
        api.GET("/api/v1/proposals", {
          params: { query: { jobId, limit, offset } },
        }),
      );
      return {
        results: data.results as ProposalListItem[],
        hasMore: data.hasMore,
      };
    },
  });
};

const useRefreshProposals = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: PROPOSALS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
  };
};

export const useMarkProposalViewed = () => {
  const api = useApi();
  const refresh = useRefreshProposals();
  return useMutation({
    mutationFn: (proposalId: string) =>
      unwrap(
        api.PATCH("/api/v1/proposals/{proposalId}/status", {
          params: { path: { proposalId }, query: {} },
        }),
      ),
    onSuccess: refresh,
  });
};

export const useShortlistProposal = () => {
  const api = useApi();
  const refresh = useRefreshProposals();
  return useMutation({
    mutationFn: (proposalId: string) =>
      unwrap(
        api.PATCH("/api/v1/proposals/{proposalId}/status", {
          params: { path: { proposalId }, query: {} },
          body: { isShortlisted: true },
        }),
      ),
    onSuccess: refresh,
  });
};

export const useStartInterview = () => {
  const api = useApi();
  const refresh = useRefreshProposals();
  return useMutation({
    mutationFn: ({
      proposalId,
      message,
    }: {
      proposalId: string;
      message: string;
    }) =>
      unwrap(
        api.POST("/api/v1/proposals/{proposalId}/interview", {
          params: { path: { proposalId }, query: {} },
          body: { message },
        }),
      ),
    onSuccess: refresh,
    onError: refresh,
  });
};

export const useContractCheckout = () => {
  const api = useApi();
  return useMutation({
    mutationFn: (proposalId: string) =>
      unwrap(
        api.POST("/api/v1/contracts/checkout", {
          params: { query: {} },
          body: { proposalId },
        }),
      ),
  });
};
