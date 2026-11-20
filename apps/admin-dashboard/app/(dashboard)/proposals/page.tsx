import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { unwrap } from "@onemarketplace/api-client";
import { ApiErrorBanner, Pagination } from "../../_components/ui";
import { parseOffset } from "../../../lib/labels";
import { fetchAdmin } from "../../_components/fetch-admin";
import { ProposalsTable } from "./proposals-table";

export const metadata: Metadata = { title: "Proposals" };

const PAGE_SIZE = 20;

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const { data, error } = await fetchAdmin(
    `/proposals?offset=${offset}`,
    (api) =>
      unwrap(
        api.GET("/api/v1/admin/proposals", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
  );
  const proposals = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Proposals"
        description="Every proposal submitted for a job post, newest first."
      />
      {error && <ApiErrorBanner error={error} />}
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
