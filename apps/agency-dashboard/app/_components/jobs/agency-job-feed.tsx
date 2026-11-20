"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { format } from "timeago.js";
import { AgencySidebar } from "../dashboard/agency-sidebar";
import { AgencyHeader } from "../dashboard/agency-header";
import { Icon } from "../ui/icon";
import { AgencyJobCard } from "./agency-job-card";
import { AgencyProposalModal } from "./agency-proposal-modal";
import type { AgencyJob } from "./types";
import { redirect } from "next/navigation";
import { useAgencyProposalMetadata } from "@/hooks/use-agency-proposal-metadata";

interface AgencySummary {
  name: string;
  avatarImage: { imageId: string; url: string } | null;
  members: unknown[];
}

const mapApiJob = (job: any): AgencyJob => ({
  id: job.id,
  title: job.title,
  company: job.companyName ?? "Client",
  verified: job.paymentVerified === true,
  posted: format(job.published_at ?? job.created_at ?? new Date()),
  budget: `$${Number(job.total_budget).toLocaleString()}`,
  budgetValue: Number(job.total_budget),
  level: job.expertise_level,
  duration: job.expected_duration,
  description: job.description,
  skills: job.skills ?? [],
  screeningQuestions: job.screening_questions ?? [],
  proposals: String(job.proposalCount ?? 0),
  hires: job.hireCount ?? 0,
  featured: (job.matchScore ?? 0) >= 4,
});

const JobCardsSkeleton = () => (
  <div className="grid gap-4" aria-label="Loading job posts" aria-busy="true">
    {[0, 1].map((item) => (
      <div
        key={item}
        className="animate-pulse rounded-2xl border border-black/8 bg-white p-7"
      >
        <div className="h-3 w-32 rounded-full bg-[#e5e8e2]" />
        <div className="mt-4 h-6 w-3/4 rounded-full bg-[#dfe4dc]" />
        <div className="mt-5 h-3 w-2/5 rounded-full bg-[#e9ece6]" />
        <div className="mt-6 h-3 w-full rounded-full bg-[#e5e8e2]" />
        <div className="mt-2 h-3 w-4/5 rounded-full bg-[#e9ece6]" />
        <div className="mt-6 flex gap-2">
          {[20, 24, 16].map((width) => (
            <div
              key={width}
              className="h-7 rounded-lg bg-[#e5e8e2]"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      </div>
    ))}
  </div>
);

export function AgencyJobFeed() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("Most recent");
  const [saved, setSaved] = useState<string[]>([]);
  const [proposalJob, setProposalJob] = useState<AgencyJob | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expertOnly, setExpertOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [minBudget, setMinBudget] = useState("");

  const { data: agency } = useQuery({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "The agency could not be loaded.");
      }
      return result.data as AgencySummary | null;
    },
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({
      role: "freelancer",
      filter: activeTab === "Most recent" ? "recent" : "best-match",
    });
    if (expertOnly) params.set("levels", "Expert");
    if (minBudget) params.set("minBudget", minBudget);
    if (verifiedOnly) params.set("paymentVerified", "true");
    return params.toString();
  }, [activeTab, expertOnly, minBudget, verifiedOnly]);

  const {
    data: apiJobs = [],
    isLoading: jobsLoading,
    isError: jobsError,
  } = useQuery({
    queryKey: ["agency-jobs", query],
    enabled: Boolean(user) && activeTab !== "Saved jobs",
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/jobs?${query}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Job posts could not be loaded.");
      }
      return result.data as any[];
    },
  });

  const { data: agencyConnects, isLoading: connectsLoading } = useQuery({
    queryKey: ["agency-connects"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/connects?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Agency Connects could not be loaded.");
      }
      return result.data as { connects: number };
    },
  });

  const { data: proposalMetadata, isLoading: proposalMetadataLoading } =
    useAgencyProposalMetadata();

  const { data: earningsSummary } = useQuery({
    queryKey: ["agency-earnings-summary"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/earnings/summary?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.message || "The earnings summary could not be loaded.",
        );
      }
      return result.data as {
        hasEarnings: boolean;
        currentMonthTotal: number;
        previousMonthTotal: number;
        series: Array<{ month: string; total: number }>;
      };
    },
  });

  const earningsChange =
    (earningsSummary?.currentMonthTotal ?? 0) -
    (earningsSummary?.previousMonthTotal ?? 0);
  const earningsChartMax = Math.max(
    ...(earningsSummary?.series.map((item) => item.total) ?? [0]),
    1,
  );

  const appliedJobIds = useMemo(
    () => new Set(proposalMetadata?.proposals.map((proposal) => proposal.jobId)),
    [proposalMetadata],
  );

  const mappedJobs = useMemo(() => apiJobs.map(mapApiJob), [apiJobs]);

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source =
      activeTab === "Saved jobs"
        ? mappedJobs.filter((job) => saved.includes(job.id))
        : mappedJobs;

    return source.filter((job) => {
      if (
        query &&
        !`${job.title} ${job.company} ${job.description} ${job.skills.join(" ")}`
          .toLowerCase()
          .includes(query)
      )
        return false;
      return true;
    });
  }, [activeTab, mappedJobs, saved, search]);

  const activeFilters =
    Number(expertOnly) + Number(verifiedOnly) + Number(Boolean(minBudget));

  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <AgencyHeader />
      <main className="mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10">
        <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-medium text-[#62805f]">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              Good morning, {agency?.name ?? "your agency"}.
            </h1>
            <p className="mt-2 text-sm text-[#72776f]">
              Here are fixed-price opportunities matched to your agency profile.
            </p>
          </div>
          <label className="flex h-12 w-full items-center gap-3 rounded-xl border border-black/9 bg-white px-4 focus-within:border-[#72956f] lg:max-w-md">
            <Icon name="search" size={20} className="text-[#7c8179]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs by title or skill"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        </div>
        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
          <AgencySidebar />
          <section className="min-w-0">
            <div className="rounded-2xl border border-black/8 bg-white px-3 pt-3">
              <div className="flex gap-1 border-b border-black/7 px-2">
                {["Most recent", "Best matches", "Saved jobs"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative cursor-pointer px-4 py-3 text-sm font-semibold ${activeTab === tab ? "text-[#4d764a]" : "text-[#777c74]"}`}
                  >
                    {tab}
                    {activeTab === tab && (
                      <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#5e875b]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="relative flex items-center justify-between px-3 py-4">
                <div>
                  <h2 className="font-semibold">{activeTab}</h2>
                  <p className="mt-0.5 text-xs text-[#858a82]">
                    {visibleJobs.length} opportunities based on your agency
                    specialties
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((current) => !current)}
                  className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border ${activeFilters ? "border-[#8eaa8a] bg-[#edf4ea] text-[#4e774b]" : "border-black/8 text-[#737870]"}`}
                >
                  <Icon name="tuning" size={19} />
                  {activeFilters > 0 && (
                    <span className="absolute -top-1 -right-1 rounded-full bg-[#5f8d5c] px-1.5 py-0.5 text-[8px] text-white">
                      {activeFilters}
                    </span>
                  )}
                </button>
                {filtersOpen && (
                  <div className="absolute top-14 right-2 z-20 w-72 rounded-2xl border border-black/8 bg-white p-5 shadow-[0_20px_60px_rgba(25,32,25,.16)]">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        Filter agency jobs
                      </h3>
                      <button
                        type="button"
                        onClick={() => setFiltersOpen(false)}
                      >
                        <Icon name="close" size={20} />
                      </button>
                    </div>
                    <div className="mt-5 grid gap-4">
                      <label className="flex items-center justify-between text-sm">
                        Expert level only
                        <input
                          type="checkbox"
                          checked={expertOnly}
                          onChange={(event) =>
                            setExpertOnly(event.target.checked)
                          }
                          className="accent-[#5f875c]"
                        />
                      </label>
                      <label className="flex items-center justify-between text-sm">
                        Payment verified
                        <input
                          type="checkbox"
                          checked={verifiedOnly}
                          onChange={(event) =>
                            setVerifiedOnly(event.target.checked)
                          }
                          className="accent-[#5f875c]"
                        />
                      </label>
                      <label className="text-xs font-semibold">
                        Minimum fixed budget
                        <input
                          type="number"
                          value={minBudget}
                          onChange={(event) => setMinBudget(event.target.value)}
                          placeholder="$0"
                          className="mt-2 h-10 w-full rounded-xl border border-black/10 px-3 text-sm font-normal"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setExpertOnly(false);
                          setVerifiedOnly(false);
                          setMinBudget("");
                        }}
                        className="text-left text-xs font-semibold text-[#52784f]"
                      >
                        Clear filters
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-4">
              {jobsLoading && activeTab !== "Saved jobs" ? (
                <JobCardsSkeleton />
              ) : jobsError ? (
                <div className="rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
                  <h2 className="font-semibold">Job posts could not be loaded</h2>
                  <p className="mt-2 text-sm text-[#777c74]">
                    Please try again in a moment.
                  </p>
                </div>
              ) : (
                <>
                  {visibleJobs.map((job) => (
                    <AgencyJobCard
                      key={job.id}
                      job={job}
                      saved={saved.includes(job.id)}
                      onSave={() =>
                        setSaved((current) =>
                          current.includes(job.id)
                            ? current.filter((id) => id !== job.id)
                            : [...current, job.id],
                        )
                      }
                      onPropose={() => setProposalJob(job)}
                      hasApplied={appliedJobIds.has(job.id)}
                      proposalMetadataLoading={proposalMetadataLoading}
                    />
                  ))}
                  {!visibleJobs.length && (
                    <div className="rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
                      <Icon
                        name="briefcase"
                        size={34}
                        className="mx-auto text-[#7c8179]"
                      />
                      <h2 className="mt-4 font-semibold">No matching jobs</h2>
                      <p className="mt-2 text-sm text-[#777c74]">
                        Try adjusting your search or filters.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
          <aside className="grid gap-5 xl:sticky xl:top-24">
            <section className="rounded-2xl border border-black/8 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Proposal activity</h2>
                <Link
                  href="/proposals"
                  className="text-xs font-semibold text-[#52784f]"
                >
                  View all
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  [String(proposalMetadata?.counts.active ?? 0), "Active"],
                  [String(proposalMetadata?.counts.viewed ?? 0), "Viewed"],
                  [
                    String(proposalMetadata?.counts.interviewed ?? 0),
                    "Interview",
                  ],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={`rounded-xl px-2 py-3 ${index === 2 ? "bg-[#eaf3e7]" : "bg-[#f2f4f0]"}`}
                  >
                    <strong className="text-lg">{value}</strong>
                    <p className="mt-1 text-[10px] text-[#81867e]">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-black/7 pt-4">
                <div className="flex justify-between text-xs">
                  <span className="text-[#777c74]">Agency Connects</span>
                  <strong>
                    {connectsLoading ? "—" : (agencyConnects?.connects ?? 0)}
                  </strong>
                </div>
                <button
                  onClick={() => redirect("/finances?section=connects")}
                  type="button"
                  className="cursor-pointer mt-3 w-full rounded-xl border border-black/10 py-2.5 text-xs font-semibold"
                >
                  Buy Connects
                </button>
              </div>
            </section>
            {earningsSummary?.hasEarnings && (
              <section className="rounded-2xl bg-[#252a26] p-5 text-white">
                <div className="flex justify-between">
                  <p className="text-xs text-[#b9c1b8]">
                    Agency earnings this month
                  </p>
                  <Icon name="chart" size={20} className="text-[#9fbb9c]" />
                </div>
                <p className="mt-3 text-3xl font-semibold">
                  ${Math.round(earningsSummary.currentMonthTotal).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-[#aeb6ad]">
                  {earningsChange >= 0 ? "+" : "-"}$
                  {Math.round(Math.abs(earningsChange)).toLocaleString()} from
                  last month
                </p>
                <div
                  className="mt-5 flex h-14 items-end gap-2"
                  aria-hidden="true"
                >
                  {earningsSummary.series.map((item) => (
                    <span
                      key={item.month}
                      className="flex-1 rounded-t bg-[#71866f]"
                      style={{
                        height: `${Math.max(4, Math.round((item.total / earningsChartMax) * 100))}%`,
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
            <section className="rounded-2xl border border-[#d5dfd2] bg-[#edf4ea] p-5">
              <Icon name="team" size={22} className="text-[#52784f]" />
              <h2 className="mt-4 font-semibold">Strengthen your agency</h2>
              <p className="mt-2 text-xs leading-5 text-[#667064]">
                Complete member profiles and add recent agency work to improve
                match quality.
              </p>
              <Link
                href="/team"
                className="mt-4 inline-block text-xs font-semibold text-[#4c7549]"
              >
                Manage team
              </Link>
            </section>
          </aside>
        </div>
      </main>
      {proposalJob && (
        <AgencyProposalModal
          job={proposalJob}
          agency={agency ?? null}
          onClose={() => setProposalJob(null)}
        />
      )}
    </div>
  );
}
