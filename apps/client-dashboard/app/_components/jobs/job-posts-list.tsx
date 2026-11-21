"use client";
import { formatCents } from "@onemarketplace/api-client";
import { Icon } from "@iconify/react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import React, { useState } from "react";
import { useJobs } from "@/app/hooks/use-jobs";
import { isJobOpen, jobErrorMessage, jobStatusLabel } from "@/lib/jobs";

const PAGE_BUTTON =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#6e916a] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40";

const JobPostsList = () => {
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching, error } = useJobs(page);
  const jobs = data?.results ?? [];

  if (isLoading) return <JobPostsSkeleton />;
  if (error) return <Message text={jobErrorMessage(error)} />;
  if (!jobs.length && page === 0)
    return <Message text="You have not posted any jobs yet." />;
  return (
    <div className="mt-8 grid gap-4">
      {jobs.map((job) => {
        const open = isJobOpen(job.status);
        const hasHires = job.hireCount > 0;

        return (
          <article
            key={job.id}
            className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      open
                        ? "bg-[#e7f2e4] text-[#4d784a]"
                        : "bg-[#f1f0e7] text-[#766f47]"
                    }`}
                  >
                    {jobStatusLabel(job.status)}
                  </span>
                  <span className="text-[10px] text-[#8a8f87]">
                    {job.createdAt
                      ? `${formatDistanceToNow(new Date(job.createdAt))} ago`
                      : "Recently created"}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-semibold">{job.title}</h2>
                <p className="mt-2 text-xs text-[#757b73]">
                  Fixed price · {formatCents(job.totalBudgetCents)} ·{" "}
                  {job.expertiseLevel} · {job.expectedDuration}
                </p>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                {!hasHires && (
                  <Link
                    href={`/jobs/${job.id}/edit`}
                    className="h-10 rounded-xl border border-black/10 px-4 py-3 text-xs font-semibold"
                  >
                    Edit
                  </Link>
                )}
                {open && (
                  <Link
                    href={`/proposals?job=${job.id}`}
                    className="h-10 rounded-xl bg-[#252724] px-4 py-3 text-xs font-semibold text-white"
                  >
                    Review proposals
                  </Link>
                )}
              </div>
            </div>

            <p className="truncate mt-5 max-w-4xl text-sm leading-6 text-[#6f756d]">
              {job.description}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {job.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-lg bg-[#f0f3ee] px-2.5 py-1.5 text-[10px] text-[#657062]"
                >
                  {skill}
                </span>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-black/7 pt-4 sm:max-w-md">
              <JobStat label={"Proposals"} value={job.proposalCount} />
              <JobStat label={"Shortlisted"} value={job.shortlistCount} />
              <JobStat label={"Hires"} value={job.hireCount} />
            </div>
          </article>
        );
      })}
      {!jobs.length && <Message text="No more job posts." />}
      {(page > 0 || data?.hasMore) && (
        <nav
          aria-label="Job posts pages"
          className="flex items-center justify-between gap-3"
        >
          <button
            type="button"
            disabled={page === 0 || isFetching}
            onClick={() => setPage((value) => Math.max(value - 1, 0))}
            className={PAGE_BUTTON}
          >
            <Icon icon="solar:arrow-left-linear" width="15" />
            Previous
          </button>
          <span className="text-xs text-[#737970]" aria-live="polite">
            Page {page + 1}
          </span>
          <button
            type="button"
            disabled={!data?.hasMore || isFetching}
            onClick={() => setPage((value) => value + 1)}
            className={PAGE_BUTTON}
          >
            Next
            <Icon icon="solar:arrow-right-linear" width="15" />
          </button>
        </nav>
      )}
    </div>
  );
};

export default JobPostsList;

function JobStat({ label, value }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-base font-semibold">{value}</p>
      <p className="mt-1 text-[10px] text-[#8a8f87]">{label}</p>
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-black/8 bg-white p-8 text-center text-sm text-[#737970]">
      {text}
    </div>
  );
}

function JobPostsSkeleton() {
  return (
    <div className="mt-8 grid gap-4" aria-label="Loading job posts">
      {[1, 2].map((item) => (
        <div
          key={item}
          className="animate-pulse rounded-2xl border border-black/8 bg-white p-5 sm:p-6"
        >
          <div className="flex justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="h-6 w-14 rounded-full bg-[#e8ebe6]" />
                <span className="h-2.5 w-20 rounded-full bg-[#eef0ec]" />
              </div>
              <div className="mt-4 h-5 w-full max-w-lg rounded-md bg-[#e4e7e2]" />
              <div className="mt-3 h-3 w-72 max-w-full rounded bg-[#eef0ec]" />
            </div>
            <div className="hidden gap-2 sm:flex">
              <span className="h-10 w-16 rounded-xl bg-[#eef0ec]" />
              <span className="h-10 w-32 rounded-xl bg-[#e4e7e2]" />
            </div>
          </div>

          <div className="mt-6 grid max-w-4xl gap-2">
            <span className="h-3 w-full rounded bg-[#eef0ec]" />
            <span className="h-3 w-4/5 rounded bg-[#eef0ec]" />
          </div>

          <div className="mt-5 flex gap-2">
            {[70, 86, 62, 92].map((width) => (
              <span
                key={width}
                style={{ width }}
                className="h-7 rounded-lg bg-[#edf1eb]"
              />
            ))}
          </div>

          <div className="mt-5 grid max-w-md grid-cols-3 gap-3 border-t border-black/7 pt-4">
            {[1, 2, 3].map((stat) => (
              <div key={stat} className="grid gap-2">
                <span className="h-4 w-6 rounded bg-[#e4e7e2]" />
                <span className="h-2.5 w-16 rounded bg-[#eef0ec]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
