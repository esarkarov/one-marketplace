"use client";

import { unwrap } from "@onemarketplace/api-client";
import {
  InvalidCheckoutUrlError,
  safeCheckoutUrl,
  useApi,
} from "@onemarketplace/web-core";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { CONTRACTS_PAGE_SIZE, type AddMilestoneBody } from "@/lib/contracts";

export const CONTRACTS_QUERY_KEY = ["client-contracts"] as const;

export const contractsListKey = (limit: number, offset: number) =>
  [...CONTRACTS_QUERY_KEY, "list", { limit, offset }] as const;

export const useContracts = (
  page = 0,
  options: { enabled?: boolean; limit?: number } = {},
) => {
  const api = useApi();
  const limit = options.limit ?? CONTRACTS_PAGE_SIZE;
  const offset = page * limit;
  return useQuery({
    queryKey: contractsListKey(limit, offset),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/contracts/client", {
          params: { query: { limit, offset } },
        }),
      ),
  });
};

const useRefreshContracts = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY });
};

const useLockedMutation = <Variables, Result>(
  run: (variables: Variables) => Promise<Result>,
  options: {
    onSuccess?: (result: Result) => unknown;
    onError?: () => unknown;
  } = {},
) => {
  const lock = useRef(false);
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: options.onSuccess,
    onError: options.onError,
    onSettled: () => {
      lock.current = false;
    },
  });
  const submit = (variables: Variables, onDone?: (result: Result) => void) => {
    if (lock.current || mutation.isPending) return;
    lock.current = true;
    mutation.mutate(variables, { onSuccess: onDone });
  };
  return {
    submit,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
};

export const useFundMilestone = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    async (input: {
      contractId: string;
      milestoneId: string;
      requirements?: string;
    }) => {
      const data = await unwrap(
        api.POST(
          "/api/v1/contracts/{contractId}/milestones/{milestoneId}/checkout",
          {
            params: {
              path: {
                contractId: input.contractId,
                milestoneId: input.milestoneId,
              },
              query: {},
            },
            body: { requirements: input.requirements },
          },
        ),
      );
      const url = safeCheckoutUrl(data.url);
      if (!url) throw new InvalidCheckoutUrlError();
      return { url };
    },
    {
      onSuccess: ({ url }) => {
        window.location.assign(url);
        void refresh();
      },
      onError: refresh,
    },
  );
};

export const useApproveMilestone = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    (input: { contractId: string; milestoneId: string }) =>
      unwrap(
        api.PATCH(
          "/api/v1/contracts/{contractId}/milestones/{milestoneId}/review",
          {
            params: {
              path: {
                contractId: input.contractId,
                milestoneId: input.milestoneId,
              },
              query: {},
            },
            body: { action: "APPROVE" },
          },
        ),
      ),
    { onSuccess: refresh, onError: refresh },
  );
};

export const useRequestMilestoneChanges = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    (input: { contractId: string; milestoneId: string; feedback: string }) =>
      unwrap(
        api.PATCH(
          "/api/v1/contracts/{contractId}/milestones/{milestoneId}/review",
          {
            params: {
              path: {
                contractId: input.contractId,
                milestoneId: input.milestoneId,
              },
              query: {},
            },
            body: { action: "REQUEST_CHANGES", feedback: input.feedback },
          },
        ),
      ),
    { onSuccess: refresh, onError: refresh },
  );
};

export const useAddMilestone = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    (input: { contractId: string; body: AddMilestoneBody }) =>
      unwrap(
        api.POST("/api/v1/contracts/{contractId}/milestones", {
          params: { path: { contractId: input.contractId }, query: {} },
          body: input.body,
        }),
      ),
    { onSuccess: refresh, onError: refresh },
  );
};

export const useFinishContract = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    (input: { contractId: string; rating: number; comment: string }) =>
      unwrap(
        api.POST("/api/v1/contracts/{contractId}/finish", {
          params: { path: { contractId: input.contractId }, query: {} },
          body: { rating: input.rating, comment: input.comment },
        }),
      ),
    { onSuccess: refresh, onError: refresh },
  );
};

export const useWithdrawContract = () => {
  const api = useApi();
  const refresh = useRefreshContracts();
  return useLockedMutation(
    (contractId: string) =>
      unwrap(
        api.PATCH("/api/v1/contracts/{contractId}/withdraw", {
          params: { path: { contractId }, query: {} },
        }),
      ),
    { onSuccess: refresh, onError: refresh },
  );
};
