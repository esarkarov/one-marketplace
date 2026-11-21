"use client";

import { unwrap } from "@onemarketplace/api-client";
import { useApi } from "@onemarketplace/web-core";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { JOB_PAGE_SIZE, type JobBody } from "@/lib/jobs";

export const JOBS_QUERY_KEY = ["client-jobs"] as const;

export const jobsListKey = (limit: number, offset: number) =>
  [...JOBS_QUERY_KEY, "list", { limit, offset }] as const;

export const jobDetailKey = (jobId: string) =>
  [...JOBS_QUERY_KEY, "detail", jobId] as const;

export const useJobs = (page: number, limit = JOB_PAGE_SIZE) => {
  const api = useApi();
  const offset = page * limit;
  return useQuery({
    queryKey: jobsListKey(limit, offset),
    placeholderData: keepPreviousData,
    queryFn: () =>
      unwrap(api.GET("/api/v1/jobs", { params: { query: { limit, offset } } })),
  });
};

export const useJob = (jobId: string) => {
  const api = useApi();
  return useQuery({
    queryKey: jobDetailKey(jobId),
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/jobs/{jobId}", {
          params: { path: { jobId }, query: {} },
        }),
      ),
  });
};

export const useSaveJob = (jobId?: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: JobBody) =>
      jobId
        ? unwrap(
            api.PUT("/api/v1/jobs/{jobId}", {
              params: { path: { jobId }, query: {} },
              body,
            }),
          )
        : unwrap(api.POST("/api/v1/jobs", { params: { query: {} }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["client-proposals-job-posts"],
      });
    },
  });
};

export const useDeleteJob = (jobId: string) => {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/jobs/{jobId}", {
          params: { path: { jobId }, query: {} },
        }),
      ),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: jobDetailKey(jobId) });
      await queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["client-proposals-job-posts"],
      });
    },
  });
};
