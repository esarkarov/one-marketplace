import type { Metadata } from "next";
import { PageHeader } from "../../_components/admin-shell";
import { ErrorBanner, Pagination } from "../../_components/ui";
import { fetchAdmin } from "../../_components/fetch-admin";
import { JobPostsTable, type AdminJobPost } from "./job-posts-table";

export const metadata: Metadata = { title: "Job Posts" };

const PAGE_SIZE = 20;

export default async function JobPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  const { data, error } = await fetchAdmin<{
    results: AdminJobPost[];
    hasMore: boolean;
  }>(`/admin/job-posts?limit=${PAGE_SIZE}&offset=${offset}`);
  const jobs = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Job posts"
        description="Every job post and its proposal/hire stats, newest first."
      />
      {error && <ErrorBanner message={error} />}
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
