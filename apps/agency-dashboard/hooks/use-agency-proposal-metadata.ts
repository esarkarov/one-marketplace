"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";

export type AgencyProposalMetadata = {
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

export const agencyProposalMetadataQueryKey = [
  "agency-proposal-metadata",
] as const;

export function useAgencyProposalMetadata() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery<AgencyProposalMetadata>({
    queryKey: agencyProposalMetadataQueryKey,
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/proposals/metadata?role=freelancer`,
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
