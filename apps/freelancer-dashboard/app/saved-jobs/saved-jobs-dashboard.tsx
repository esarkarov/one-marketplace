"use client";

import { useAuth } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "timeago.js";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DashboardHeader } from "../_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "../_components/dashboard/workspace-sidebar";
import { useProposalMetadata } from "../_components/proposals/use-proposal-metadata";

type Job = {
  id: string;
  title: string;
  companyName: string;
  savedAt: string;
  published_at: string | null;
  created_at: string | null;
  total_budget: string;
  expertise_level: string;
  expected_duration: string;
  description: string;
  skills: string[];
  paymentVerified: boolean;
  proposalCount: number;
};

const proposalLabel = (count: number) => {
  if (count < 5) return "Less than 5 proposals";
  if (count < 10) return "5 to 10 proposals";
  if (count < 15) return "10 to 15 proposals";
  if (count < 20) return "15 to 20 proposals";
  return "20+ proposals";
};

export function SavedJobsDashboard() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [removed, setRemoved] = useState<Job | null>(null);
  const { data: proposalMetadata } = useProposalMetadata();
  const appliedJobIds = useMemo(
    () => new Set(proposalMetadata?.proposals.map(({ jobId }) => jobId) ?? []),
    [proposalMetadata],
  );
  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ["saved-jobs"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/saved?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = jobs.filter((job) =>
      `${job.title} ${job.companyName} ${job.skills.join(" ")}`
        .toLowerCase()
        .includes(query),
    );
    return sort === "budget"
      ? [...result].sort(
          (a, b) => Number(b.total_budget) - Number(a.total_budget),
        )
      : result;
  }, [jobs, search, sort]);

  const remove = async (job: Job) => {
    queryClient.setQueryData<Job[]>(["saved-jobs"], (current = []) =>
      current.filter((item) => item.id !== job.id),
    );
    setRemoved(job);
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/saved/${job.id}?role=freelancer`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      queryClient.setQueryData<Job[]>(["saved-jobs"], (current = []) => [
        job,
        ...current,
      ]);
      setRemoved(null);
      return;
    }
    window.setTimeout(() => setRemoved(null), 3500);
  };

  const undo = async () => {
    if (!removed) return;
    const job = removed;
    setRemoved(null);
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/saved/${job.id}?role=freelancer`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.ok)
      queryClient.setQueryData<Job[]>(["saved-jobs"], (current = []) => [
        job,
        ...current,
      ]);
  };

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <WorkspaceSidebar />
          <div className="min-w-0">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
                  Your shortlist
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                  Saved jobs
                </h1>
                <p className="mt-2 text-sm text-[#72776f]">
                  Keep promising opportunities together and apply when you’re
                  ready.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white! hover:bg-[#3b3e39]"
              >
                <Icon icon="solar:magnifer-linear" width="18" />
                Browse jobs
              </Link>
            </div>
            <section className="mt-8 rounded-2xl border border-black/8 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex h-11 flex-1 items-center gap-3 rounded-xl border border-black/9 px-3.5">
                  <Icon
                    icon="solar:magnifer-linear"
                    width="19"
                    className="text-[#7b8078]"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search saved jobs by title, company, or skill"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="h-11 rounded-xl border border-black/9 bg-white px-4 text-sm font-medium outline-none"
                >
                  <option value="recent">Recently saved</option>
                  <option value="budget">Highest budget</option>
                </select>
              </div>
            </section>
            <div className="mt-4 grid gap-4">
              {isLoading && (
                <div className="h-64 animate-pulse rounded-2xl border border-black/8 bg-white" />
              )}
              {visible.map((job) => (
                <article
                  key={job.id}
                  className="rounded-2xl border border-black/8 bg-white p-5 transition sm:p-7"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs text-[#858a82]">
                        Saved {format(job.savedAt)} · Posted{" "}
                        {format(
                          job.published_at ?? job.created_at ?? job.savedAt,
                        )}
                      </p>
                      <h2 className="mt-3 text-xl leading-7 font-semibold tracking-[-0.025em]">
                        {job.title}
                      </h2>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link
                        href={`/jobs/${job.id}`}
                        target="_blank"
                        aria-label="Open full job"
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-[#737870] hover:bg-[#f2f5f0] hover:text-[#4e774b]"
                      >
                        <Icon icon="solar:arrow-right-up-linear" width="20" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void remove(job)}
                        aria-label="Remove saved job"
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[#a8c3a4] bg-[#e8f2e5] text-[#4e784b]"
                      >
                        <Icon icon="solar:bookmark-bold" width="20" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-[#656a63]">
                    <span>Fixed price</span>
                    <span>${Number(job.total_budget).toLocaleString()}</span>
                    <span>{job.expertise_level}</span>
                    <span>{job.expected_duration}</span>
                  </div>
                  <p className="mt-5 text-sm line-clamp-3 leading-6 text-[#626860]">
                    {job.description}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {job.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-lg bg-[#eef2ec] px-2.5 py-1.5 text-xs font-medium text-[#596057]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-col justify-between gap-4 border-t border-black/7 pt-5 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#737870]">
                        <strong className="text-[#343833]">
                          {job.companyName}
                        </strong>
                        {job.paymentVerified && (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#4f784c]">
                            <Icon icon="solar:verified-check-bold" width="15" />
                            Payment verified
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-[#858a82]">
                        {proposalLabel(job.proposalCount)}
                      </p>
                    </div>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="rounded-xl bg-[#252724] px-5 py-2.5 text-center text-sm font-semibold text-white! hover:bg-[#3b3e39]"
                    >
                      {appliedJobIds.has(job.id)
                        ? "Proposal submitted"
                        : "Submit a proposal"}
                    </Link>
                  </div>
                </article>
              ))}
              {!isLoading && !visible.length && (
                <div className="rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
                  <Icon
                    icon="solar:bookmark-linear"
                    width="30"
                    className="mx-auto text-[#788076]"
                  />
                  <h2 className="mt-4 text-lg font-semibold">
                    No saved jobs found
                  </h2>
                  <p className="mt-2 text-sm text-[#777c74]">
                    {jobs.length
                      ? "Try a different search term."
                      : "Save opportunities from the job feed and they’ll appear here."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      {removed && (
        <div
          role="status"
          className="fixed right-5 bottom-5 z-50 flex items-center gap-4 rounded-xl bg-[#252724] px-5 py-3.5 text-sm text-white shadow-xl"
        >
          <span>Removed from saved jobs</span>
          <button
            type="button"
            onClick={() => void undo()}
            className="cursor-pointer font-semibold text-[#a9cba5]"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
