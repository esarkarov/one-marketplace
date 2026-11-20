import { Icon } from "@iconify/react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClientShell } from "../_components/dashboard/client-shell";
import JobPostsList from "../_components/jobs/job-posts-list";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Job Posts",
  description: "Manage your fixed-price marketplace job posts.",
};

export default function JobsPage() {
  return (
    <Suspense>
      <ClientShell>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
              Hiring
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
              Job posts
            </h1>
            <p className="mt-2 text-sm text-[#72776f]">
              Create fixed-price projects and review applicant activity.
            </p>
          </div>
          <Link
            href="/jobs/new"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
          >
            <Icon icon="solar:add-circle-linear" width="18" />
            Post a new job
          </Link>
        </div>

        <JobPostsList />
      </ClientShell>
    </Suspense>
  );
}
