import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { unwrap } from "@onemarketplace/api-client";
import { ApiErrorBanner, Pagination } from "../../_components/ui";
import { parseOffset } from "../../../lib/labels";
import { fetchAdmin } from "../../_components/fetch-admin";
import { JobPostsTable } from "./job-posts-table";

export const metadata: Metadata = { title: "Job Posts" };

const PAGE_SIZE = 20;

export default async function JobPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const { data, error } = await fetchAdmin(
    `/job-posts?offset=${offset}`,
    (api) =>
      unwrap(
        api.GET("/api/v1/admin/job-posts", {
          params: { query: { limit: PAGE_SIZE, offset } },
        }),
      ),
  );
  const jobs = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Job posts"
        description="Every job post and its proposal/hire stats, newest first."
      />
      {error && <ApiErrorBanner error={error} />}
      <JobPostsTable
        jobs={jobs}
        footer={
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            count={jobs.length}
            hasMore={data?.hasMore ?? false}
            basePath="/job-posts"
          />
        }
      />
    </>
  );
}
