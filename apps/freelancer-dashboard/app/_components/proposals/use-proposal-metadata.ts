"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";

export type FreelancerProposalMetadata = {
  proposals: Array<{
    jobId: string;
    status: string;
    submittedAt: string | null;
  }>;
  counts: {
    total: number;
    active: number;
    viewed: number;
    interviewed: number;
  };
};

export const proposalMetadataQueryKey = [
  "freelancer-proposal-metadata",
] as const;

export function useProposalMetadata() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery<FreelancerProposalMetadata>({
    queryKey: proposalMetadataQueryKey,
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/proposals/metadata?role=freelancer`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || "Proposal activity could not be loaded.",
        );
      }
      return result.data;
    },
  });
}
