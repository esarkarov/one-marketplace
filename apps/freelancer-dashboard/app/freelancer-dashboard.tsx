"use client";

import { Icon } from "@iconify/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  redirect,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { DashboardHeader } from "./_components/dashboard/dashboard-header";
import { WorkspaceSidebar } from "./_components/dashboard/workspace-sidebar";
import { JobCard } from "./_components/jobs/job-card";
import {
  emptyJobFilters,
  JobFilterPopover,
  type JobFilters,
} from "./_components/jobs/job-filter-popover";
import { ProposalModal } from "./_components/jobs/proposal-modal";
import type { Job } from "./_components/jobs/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/nextjs";
import { format } from "timeago.js";
import { useProposalMetadata } from "./_components/proposals/use-proposal-metadata";

type ApiJob = {
  id: string;
  title: string;
  description: string;
  expertise_level: string;
  expected_duration: string;
  skills: string[];
  total_budget: string;
  published_at: string | null;
  created_at: string | null;
  companyName: string;
  clientCountry?: string | null;
  paymentVerified: boolean;
  proposalCount?: number;
  matchScore?: number;
  savedAt?: string | null;
};

const emptySavedJobs: ApiJob[] = [];

export const proposalRange = (range: string) => {
  if (range === "Less than 5") return { maxProposals: "4" };
  if (range === "5 to 10") return { minProposals: "5", maxProposals: "10" };
  if (range === "10 to 15") return { minProposals: "10", maxProposals: "15" };
  return {};
};

const JobCardsSkeleton = () => (
  <div className="grid gap-4" aria-label="Loading job posts" aria-busy="true">
    {[0, 2].map((item) => (
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

export function FreelancerDashboard() {
  const [search, setSearch] = useState("");
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("Most recent");
  const [proposalJob, setProposalJob] = useState<Job | null>(null);
  const [autoOpenedProposalId, setAutoOpenedProposalId] = useState<
    string | null
  >(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<JobFilters>(emptyJobFilters);
  const [saveCooldowns, setSaveCooldowns] = useState<Record<string, number>>(
    {},
  );
  const [optimisticSavedJobs, setOptimisticSavedJobs] = useState<
    Record<string, boolean>
  >({});
  const [cooldownNow, setCooldownNow] = useState(Date.now());
  const [savingJobIds, setSavingJobIds] = useState<string[]>([]);

  const { data: profileMetaData, isLoading: profileMetaDataLoading } = useQuery(
    {
      queryKey: ["profile-metadata"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "The client profile could not be loaded.",
          );
        }

        return result.data;
      },
    },
  );

  const { data: earningsSummary } = useQuery({
    queryKey: ["freelancer-earnings-summary"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/earnings/summary?role=freelancer`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
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

  const personalFields = [
    user?.firstName,
    user?.lastName,
    profileMetaData?.country,
    profileMetaData?.city,
  ];

  const professionalFields = [
    profileMetaData?.professional_title,
    profileMetaData?.professional_description,
    profileMetaData?.hourly_rate,
    profileMetaData?.availability_status,
    profileMetaData?.weekly_availability,
    profileMetaData?.experience_level,
  ];

  const skills = profileMetaData?.skills ?? [];
  const portfolios = profileMetaData?.portfolios ?? [];
  const completedLanguages =
    profileMetaData?.languages?.filter(
      (item: { language: string }) => item.language,
    ).length ?? 0;

  const strengthSuggestions = [
    !user?.hasImage && "Add a real profile photo.",
    personalFields.some((field) => !field) && "Complete your personal details.",
    professionalFields.some((field) => !field) &&
      "Complete every professional field.",
    skills.length < 10 && `Add ${10 - skills.length} more skills.`,
    completedLanguages < 3 && `Add ${3 - completedLanguages} more languages.`,
    portfolios.length < 3 &&
      `Add ${3 - portfolios.length} more portfolio projects.`,
  ].filter(Boolean) as string[];

  const activeFilterCount =
    filters.experienceLevels.length +
    filters.durations.length +
    Number(Boolean(filters.minBudget || filters.maxBudget)) +
    Number(filters.proposalRange !== "Any number") +
    Number(filters.verifiedOnly);

  const { data: connectsMetadata } = useQuery({
    queryKey: ["connects"],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/connects?role=freelancer`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "The client profile could not be loaded.",
        );
      }

      return result.data;
    },
  });

  const { data: savedJobs = emptySavedJobs, isLoading: savedJobsLoading } =
    useQuery<ApiJob[]>({
      queryKey: ["saved-jobs"],
      enabled: Boolean(user),
      queryFn: async () => {
        const token = await getToken();
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/saved?role=freelancer`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message || "Saved jobs could not be loaded.");
        }
        return result.data;
      },
    });

  const savedJobIds = useMemo(
    () => new Set(savedJobs.map((job) => job.id)),
    [savedJobs],
  );

  const effectiveSaveCooldowns = useMemo(() => {
    const deadlines = { ...saveCooldowns };
    savedJobs.forEach((job) => {
      const savedAt = new Date(job.savedAt ?? 0).getTime();
      deadlines[job.id] = Math.max(
        deadlines[job.id] ?? 0,
        Number.isNaN(savedAt) ? 0 : savedAt + 5_000,
      );
    });
    return deadlines;
  }, [saveCooldowns, savedJobs]);

  useEffect(() => {
    if (
      !Object.values(effectiveSaveCooldowns).some(
        (deadline) => deadline > cooldownNow,
      )
    )
      return;
    const interval = window.setInterval(() => setCooldownNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [cooldownNow, effectiveSaveCooldowns]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      role: "freelancer",
      filter: activeTab === "Most recent" ? "recent" : "best-match",
    });
    if (filters.experienceLevels.length)
      params.set("levels", filters.experienceLevels.join(","));
    if (filters.durations.length)
      params.set("durations", filters.durations.join(","));
    if (filters.minBudget) params.set("minBudget", filters.minBudget);
    if (filters.maxBudget) params.set("maxBudget", filters.maxBudget);
    if (filters.verifiedOnly) params.set("paymentVerified", "true");
    Object.entries(proposalRange(filters.proposalRange)).forEach(
      ([key, value]) => params.set(key, value),
    );
    return params.toString();
  }, [activeTab, filters]);

  const {
    data: jobs = [],
    isLoading: jobsLoading,
    isError: jobsError,
  } = useQuery({
    queryKey: ["freelancer-jobs", query],
    enabled: Boolean(user),
    queryFn: async () => {
      const token = await getToken();

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/jobs?${query}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "The client profile could not be loaded.",
        );
      }

      return result.data;
    },
  });
  const mapApiJob = (job: any): Job => ({
    id: job.id,
    title: job.title,
    company: job.companyName,
    verified: job.paymentVerified,
    posted: format(job.published_at ?? job.created_at ?? new Date()),
    type: "Fixed price",
    budget: `$${Number(job.total_budget).toLocaleString()}`,
    level: job.expertise_level,
    duration: job.expected_duration,
    description: job.description,
    skills: job.skills,
    screeningQuestions: job.screening_questions ?? [],
    proposals: String(job.proposalCount),
    hires: job.hireCount ?? 0,
    featured: (job.matchScore ?? 0) >= 4,
  });

  const mappedJobs = useMemo<Job[]>(
    () => (activeTab === "Saved jobs" ? savedJobs : jobs).map(mapApiJob),
    [activeTab, jobs, savedJobs],
  );

  const jobsById = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of [...jobs, ...savedJobs]) {
      if (!map.has(job.id)) map.set(job.id, mapApiJob(job));
    }
    return map;
  }, [jobs, savedJobs]);

  const openProposalModal = (job: Job) => {
    setProposalJob(job);
    const params = new URLSearchParams(searchParams.toString());
    params.set("proposal", job.id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const closeProposalModal = () => {
    setProposalJob(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("proposal");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  useEffect(() => {
    const proposalId = searchParams.get("proposal");
    if (!proposalId || proposalId === autoOpenedProposalId) return;
    const job = jobsById.get(proposalId);
    if (job) {
      setProposalJob(job);
      setAutoOpenedProposalId(proposalId);
    }
  }, [searchParams, jobsById, autoOpenedProposalId]);

  const { data: proposalMetadata, isLoading: proposalMetadataLoading } =
    useProposalMetadata();

  const appliedJobIds = useMemo(
    () =>
      new Set(
        proposalMetadata?.proposals?.map((proposal) => proposal.jobId) ?? [],
      ),
    [proposalMetadata],
  );

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return mappedJobs.filter((job) => {
      const searchable = [
        job.title,
        job.company,
        job.description,
        ...job.skills,
      ]
        .join(" ")
        .toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (
        activeTab === "Saved jobs" &&
        !(optimisticSavedJobs[job.id] ?? savedJobIds.has(job.id))
      ) {
        return false;
      }
      return true;
    });
  }, [mappedJobs, mappedJobs, optimisticSavedJobs, savedJobIds, search]);

  const toggleSaved = async (id: string) => {
    if (
      (effectiveSaveCooldowns[id] ?? 0) > Date.now() ||
      savingJobIds.includes(id)
    )
      return;
    const isSaved = optimisticSavedJobs[id] ?? savedJobIds.has(id);
    const optimisticsState = !isSaved;
    const cooldownDeadline = Date.now() + 5_000;
    setOptimisticSavedJobs((current) => ({
      ...current,
      [id]: optimisticsState,
    }));
    setSaveCooldowns((current) => ({
      ...current,
      [id]: cooldownDeadline,
    }));
    setCooldownNow(Date.now());
    setSavingJobIds((current) => [...current, id]);

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/saved/${id}?role=freelancer`,
        {
          method: isSaved ? "DELETE" : "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        if (response.status === 429) {
          setOptimisticSavedJobs((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          return;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["saved-jobs"] });
      setOptimisticSavedJobs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch {
      setOptimisticSavedJobs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } finally {
      setSavingJobIds((current) => current.filter((jobId) => jobId !== id));
    }
  };

  return (
    <div className="min-h-svh bg-[#f4f6f2] font-(family-name:--font-dm-sans) text-[#242724]">
      <DashboardHeader />

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
              Good morning, {user?.firstName}.
            </h1>
            <p className="mt-2 text-sm text-[#72776f]">
              Here are fresh opportunities matched to your profile.
            </p>
          </div>
          <label className="flex h-12 w-full items-center gap-3 rounded-xl border border-black/9 bg-white px-4 focus-within:border-[#72956f] lg:max-w-md">
            <Icon
              icon="solar:magnifer-linear"
              width="20"
              className="text-[#7c8179]"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs by title or skill"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a0a49e]"
            />
            <kbd className="hidden rounded-md border border-black/8 bg-[#f4f5f2] px-2 py-1 text-[10px] text-[#8b8f88] sm:block">
              ⌘ K
            </kbd>
          </label>
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
          <WorkspaceSidebar />

          <section className="min-w-0">
            <div className="rounded-2xl border border-black/8 bg-white px-3 pt-3">
              <div className="flex gap-1 overflow-x-auto border-b border-black/7 px-2">
                {["Most recent", "Best matches", "Saved jobs"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative shrink-0 cursor-pointer px-4 py-3 text-sm font-semibold ${
                      activeTab === tab ? "text-[#4d764a]" : "text-[#777c74]"
                    }`}
                  >
                    {tab}
                    {activeTab === tab && (
                      <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#5e875b]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-3 py-4">
                <div>
                  <h2 className="font-semibold">{activeTab}</h2>
                  <p className="mt-0.5 text-xs text-[#858a82]">
                    {visibleJobs.length} opportunities based on your skills
                  </p>
                </div>
                <JobFilterPopover
                  filters={filters}
                  activeCount={activeFilterCount}
                  onApply={setFilters}
                  onClear={() => setFilters(emptyJobFilters)}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              {(activeTab === "Saved jobs" ? savedJobsLoading : jobsLoading) ? (
                <JobCardsSkeleton />
              ) : (
                <>
                  {visibleJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      saved={
                        optimisticSavedJobs[job.id] ?? savedJobIds.has(job.id)
                      }
                      onSave={() => void toggleSaved(job.id)}
                      saveDisabled={
                        savingJobIds.includes(job.id) ||
                        (effectiveSaveCooldowns[job.id] ?? 0) > cooldownNow
                      }
                      saveCooldownSeconds={Math.max(
                        0,
                        Math.ceil(
                          ((effectiveSaveCooldowns[job.id] ?? 0) -
                            cooldownNow) /
                            500,
                        ),
                      )}
                      onPropose={() => openProposalModal(job)}
                      hasApplied={appliedJobIds.has(job.id)}
                      proposalMetadataLoading={proposalMetadataLoading}
                    />
                  ))}
                  {!visibleJobs.length && (
                    <div className="rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
                      <Icon
                        icon="solar:case-minimalistic-linear"
                        width="34"
                        className="mx-auto text-[#7c8179]"
                      />
                      <h2 className="mt-4 text-lg font-semibold">
                        No jobs here yet
                      </h2>
                      <p className="mt-2 text-sm text-[#777c74]">
                        {activeTab === "Saved jobs"
                          ? "Save a job and it will appear here."
                          : activeFilterCount
                            ? "Try adjusting or clearing your job filters."
                            : "Try a broader search term."}
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
                  href="/my-proposals"
                  className="text-xs font-semibold text-[#52784f]"
                >
                  View all
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  [String(proposalMetadata?.counts?.active ?? "..."), "Active"],
                  [String(proposalMetadata?.counts?.viewed ?? "..."), "Viewed"],
                  [
                    String(proposalMetadata?.counts?.interviewed ?? "..."),
                    "Interviews",
                  ],
                ].map(([value, label], index) => (
                  <div
                    key={label}
                    className={`rounded-xl px-2 py-3 ${
                      index === 2 ? "bg-[#eaf3e7]" : "bg-[#f2f4f0]"
                    }`}
                  >
                    <strong
                      className={
                        index === 2 ? "text-lg text-[#4f784c]" : "text-lg"
                      }
                    >
                      {value}
                    </strong>
                    <p className="mt-1 text-[10px] text-[#81867e]">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-black/7 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#777c74]">Available Connects</span>
                  <strong>{connectsMetadata?.connects || "..."}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => redirect("/settings?section=connects")}
                  className="mt-3 w-full cursor-pointer rounded-xl border border-black/10 py-2.5 text-xs font-semibold hover:bg-black/3"
                >
                  Buy Connects
                </button>
              </div>
            </section>

            {earningsSummary?.hasEarnings && (
              <section className="rounded-2xl bg-[#252a26] p-5 text-white">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[#b9c1b8]">
                    Earnings this month
                  </p>
                  <Icon
                    icon="solar:chart-2-linear"
                    width="20"
                    className="text-[#9fbb9c]"
                  />
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
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
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#52784f]">
                <Icon icon="solar:lightbulb-bolt-linear" width="21" />
              </span>
              <h2 className="mt-4 font-semibold">Stand out to clients</h2>
              <p className="mt-2 text-xs leading-5 text-[#667064]">
                {profileMetaDataLoading || !isLoaded
                  ? "..."
                  : strengthSuggestions.join(" ")}
              </p>
              <Link
                href="/my-profile"
                className="mt-4 inline-block text-xs font-semibold text-[#4c7549] hover:underline"
              >
                Update portfolio
              </Link>
            </section>
          </aside>
        </div>
      </main>

      {proposalJob && (
        <ProposalModal job={proposalJob} onClose={closeProposalModal} />
      )}
    </div>
  );
}
