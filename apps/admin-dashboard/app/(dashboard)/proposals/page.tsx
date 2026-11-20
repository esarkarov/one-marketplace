import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { ErrorBanner, Pagination } from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { ProposalsTable, type AdminProposal } from "./proposals-table";

export const metadata: Metadata = { title: "Proposals" };

const PAGE_SIZE = 20;

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const { data, error } = await fetchAdmin<{
    results: AdminProposal[];
    hasMore: boolean;
  }>(`/admin/proposals?limit=${PAGE_SIZE}&offset=${offset}`);
  const proposals = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Proposals"
        description="Every proposal submitted for a job post, newest first."
      />
      {error && <ErrorBanner message={error} />}
      <ProposalsTable
        proposals={proposals}
        footer={
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            count={proposals.length}
            hasMore={data?.hasMore ?? false}
            basePath="/proposals"
          />
        }
      />
    </>
  );
}
