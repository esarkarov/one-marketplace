"use client";

import { unwrap } from "@onemarketplace/api-client";
import { queryKeys, useApiConfig, useApi } from "@onemarketplace/web-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CONTRACTS_QUERY_KEY } from "@/app/hooks/use-contracts";

export const useReviewMilestone = () => {
  const api = useApi();
  const { role, scope } = useApiConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      milestoneId: string;
      conversationId: string;
      action: "APPROVE" | "REQUEST_CHANGES";
      feedback?: string;
    }) =>
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
            body: { action: input.action, feedback: input.feedback },
          },
        ),
      ),
    onSettled: (_result, _error, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationMessages(
          role,
          scope,
          input.conversationId,
        ),
      });
      void queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY });
    },
  });
};
