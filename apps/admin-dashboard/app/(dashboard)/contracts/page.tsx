import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { unwrap } from "@onemarketplace/api-client";
import { ApiErrorBanner, Pagination } from "../../_components/ui";
import { parseOffset } from "../../../lib/labels";
import { fetchAdmin } from "../../_components/fetch-admin";
import { ContractsTable } from "./contracts-table";

export const metadata: Metadata = { title: "Contracts" };

const PAGE_SIZE = 20;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const { data, error } = await fetchAdmin(
    `/contracts?offset=${offset}`,
    (api) =>
      unwrap(
        api.GET("/api/v1/admin/contracts", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
  );
  const contracts = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Contracts"
        description="Every contract between a client and talent, newest first."
      />
      {error && <ApiErrorBanner error={error} />}
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
