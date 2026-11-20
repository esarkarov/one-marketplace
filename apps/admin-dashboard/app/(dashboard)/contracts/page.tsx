import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { ErrorBanner, Pagination } from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { ContractsTable, type AdminContract } from "./contracts-table";

export const metadata: Metadata = { title: "Contracts" };

const PAGE_SIZE = 20;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const { data, error } = await fetchAdmin<{
    results: AdminContract[];
    hasMore: boolean;
  }>(`/admin/contracts?limit=${PAGE_SIZE}&offset=${offset}`);
  const contracts = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Contracts"
        description="Every contract between a client and talent, newest first."
      />
      {error && <ErrorBanner message={error} />}
      <ContractsTable
        contracts={contracts}
        footer={
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            count={contracts.length}
            hasMore={data?.hasMore ?? false}
            basePath="/contracts"
          />
        }
      />
    </>
  );
}
