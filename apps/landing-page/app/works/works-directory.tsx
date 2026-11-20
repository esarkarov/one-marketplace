"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./works.module.css";

type Experience = "Entry level" | "Intermediate" | "Expert";
type Sort = "newest" | "budget" | "rating" | "proposals";

interface Job {
  id: string;
  title: string;
  description: string;
  skills: string[];
  totalBudget: number;
  expectedDuration: string;
  expertiseLevel: string;
  publishedAt: string | null;
  companyName: string;
  clientLocation: string | null;
  paymentVerified: boolean;
  clientRating: number;
  clientTotalSpent: number;
  proposalCount: number;
}

const SEARCH_DEBOUNCE_MS = 700;
const experienceLevels: Experience[] = [
  "Entry level",
  "Intermediate",
  "Expert",
];

function postedAgo(publishedAt: string | null) {
  if (!publishedAt) return "recently";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(publishedAt).getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes || 1} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatBudget(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatSpent(value: number) {
  if (value <= 0) return "New client";
  if (value < 1000) return `$${Math.round(value)} spent`;
  return `$${Math.floor(value / 1000)}k+ spent`;
}

function formatProposalCount(count: number) {
  if (count < 5) return "Less than 5 proposals";
  if (count < 10) return "5 to 10 proposals";
  if (count < 15) return "10 to 15 proposals";
  if (count < 20) return "15 to 20 proposals";
  return "20+ proposals";
}

interface FilterProps {
  experience: Experience[];
  toggleExperience: (value: Experience) => void;
  verifiedOnly: boolean;
  setVerifiedOnly: (value: boolean) => void;
  lowProposalsOnly: boolean;
  setLowProposalsOnly: (value: boolean) => void;
  minBudget: number;
  setMinBudget: (value: number) => void;
  maxBudget: number;
  setMaxBudget: (value: number) => void;
  resetFilters: () => void;
}

function FilterControls(props: FilterProps) {
  const {
    experience,
    toggleExperience,
    verifiedOnly,
    setVerifiedOnly,
    lowProposalsOnly,
    setLowProposalsOnly,
    minBudget,
    setMinBudget,
    maxBudget,
    setMaxBudget,
    resetFilters,
  } = props;
  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="text-sm font-semibold">Experience level</legend>
        <div className="mt-3 grid gap-3">
          {experienceLevels.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-3 text-sm text-[#62665f]"
            >
              <input
                type="checkbox"
                checked={experience.includes(level)}
                onChange={() => toggleExperience(level)}
                className="h-4 w-4 rounded accent-[#456f42]"
              />
              {level}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="border-t border-black/7 pt-6">
        <p className="text-sm font-semibold">Client quality</p>
        <div className="mt-3 grid gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-[#62665f]">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="h-4 w-4 rounded accent-[#456f42]"
            />
            Payment verified
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-[#62665f]">
            <input
              type="checkbox"
              checked={lowProposalsOnly}
              onChange={(e) => setLowProposalsOnly(e.target.checked)}
              className="h-4 w-4 rounded accent-[#456f42]"
            />
            Fewer than 10 proposals
          </label>
        </div>
      </div>

      <div className="border-t border-black/7 pt-6">
        <p className="text-sm font-semibold">Budget</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium text-[#777b74]">
            Minimum
            <span className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
                $
              </span>
              <input
                type="number"
                min={0}
                value={minBudget || ""}
                onChange={(e) =>
                  setMinBudget(Math.max(0, Number(e.target.value)))
                }
                className="h-11 w-full rounded-xl border border-black/10 bg-white pr-2 pl-7 text-sm font-normal outline-none focus:border-[#668c63]"
                placeholder="0"
              />
            </span>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[#777b74]">
            Maximum
            <span className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">
                $
              </span>
              <input
                type="number"
                min={0}
                value={maxBudget || ""}
                onChange={(e) =>
                  setMaxBudget(Math.max(0, Number(e.target.value)))
                }
                className="h-11 w-full rounded-xl border border-black/10 bg-white pr-2 pl-7 text-sm font-normal outline-none focus:border-[#668c63]"
                placeholder="Any"
              />
            </span>
          </label>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-[#8a8e87]">
          Applies to the total fixed-price project budget.
        </p>
      </div>

      <button
        type="button"
        onClick={resetFilters}
        className="text-sm font-semibold text-[#477344] hover:underline"
      >
        Reset all filters
      </button>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-6 transition hover:border-black/13 sm:p-7">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#81857e]">
          Posted {postedAgo(job.publishedAt)} ago
        </p>
        <h2 className={`${styles.uiHeading} mt-2 text-xl text-[#252824]`}>
          {job.title}
        </h2>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-[#666b64]">
        <span>Fixed price</span>
        <span>{formatBudget(job.totalBudget)}</span>
        <span>{job.expectedDuration}</span>
        <span>{job.expertiseLevel}</span>
      </div>
      <p className="mt-5 line-clamp-3 text-sm leading-6 text-[#626760]">
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#737870]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#31352f]">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-[#668c63]"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4.5 20V7.5L12 4l7.5 3.5V20M8 10h1m3-1v1m3-1v1m-7 4h1m3-1v1m3-1v1M3 20h18"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {job.companyName}
          </span>
          {job.paymentVerified ? (
            <span className="inline-flex items-center gap-1 font-semibold text-[#4d764a]">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e4f1e1] text-[10px]">
                ✓
              </span>
              Payment verified
            </span>
          ) : (
            <span>Payment unverified</span>
          )}
          {job.clientRating > 0 && (
            <>
              <span className="text-[#d2a43a]">★</span>
              <span>{job.clientRating.toFixed(1)}</span>
            </>
          )}
          <span>{formatSpent(job.clientTotalSpent)}</span>
          {job.clientLocation && <span>{job.clientLocation}</span>}
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <span className="text-xs text-[#858981]">
            {formatProposalCount(job.proposalCount)}
          </span>
          <Link
            href="/signup?role=freelancer"
            className="rounded-xl bg-[#252724] px-4 py-2.5 text-sm font-semibold text-white! transition hover:bg-[#3b3e39]"
          >
            Apply as a freelancer
          </Link>
        </div>
      </div>
    </article>
  );
}

function JobCardSkeleton() {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-6 sm:p-7">
      <div className={`h-3 w-24 rounded-md ${styles.shimmer}`} />
      <div className={`mt-3 h-5 w-4/5 rounded-md ${styles.shimmer}`} />
      <div className="mt-4 flex gap-3">
        {[14, 16, 12, 14].map((width, index) => (
          <div
            key={index}
            className={`h-3 rounded-md ${styles.shimmer}`}
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="mt-5 space-y-2">
        <div className={`h-3 w-full rounded-md ${styles.shimmer}`} />
        <div className={`h-3 w-11/12 rounded-md ${styles.shimmer}`} />
        <div className={`h-3 w-2/3 rounded-md ${styles.shimmer}`} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {[16, 20, 14].map((width, index) => (
          <div
            key={index}
            className={`h-7 rounded-lg ${styles.shimmer}`}
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-black/7 pt-5">
        <div className={`h-3 w-2/5 rounded-md ${styles.shimmer}`} />
        <div className={`h-10 w-36 rounded-xl ${styles.shimmer}`} />
      </div>
    </article>
  );
}

export function WorksDirectory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [experience, setExperience] = useState<Experience[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [lowProposalsOnly, setLowProposalsOnly] = useState(false);
  const [minBudget, setMinBudget] = useState(0);
  const [maxBudget, setMaxBudget] = useState(0);
  const [sort, setSort] = useState<Sort>("newest");

  const [resultsState, setResultsState] = useState<{
    key: string;
    jobs: Job[];
    hasMore: boolean;
  } | null>(null);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [search]);

  const toggleExperience = (value: Experience) =>
    setExperience((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        debouncedSearch,
        experience,
        verifiedOnly,
        lowProposalsOnly,
        minBudget,
        maxBudget,
        sort,
      }),
    [
      debouncedSearch,
      experience,
      verifiedOnly,
      lowProposalsOnly,
      minBudget,
      maxBudget,
      sort,
    ],
  );

  const fetchPage = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({
        query: debouncedSearch,
        sort,
        offset: String(offset),
      });
      if (experience.length) params.set("levels", experience.join(","));
      if (verifiedOnly) params.set("paymentVerified", "true");
      if (lowProposalsOnly) params.set("maxProposals", "9");
      if (minBudget) params.set("minBudget", String(minBudget));
      if (maxBudget) params.set("maxBudget", String(maxBudget));

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/public?${params.toString()}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Job search failed.");
      }
      return result.data as { results: Job[]; hasMore: boolean };
    },
    [
      debouncedSearch,
      sort,
      experience,
      verifiedOnly,
      lowProposalsOnly,
      minBudget,
      maxBudget,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage(0)
      .then((page) => {
        if (cancelled) return;
        setResultsState({
          key: filterKey,
          jobs: page.results,
          hasMore: page.hasMore,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setResultsState({ key: filterKey, jobs: [], hasMore: false });
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, fetchPage]);

  const isLoading = resultsState === null || resultsState.key !== filterKey;
  const jobs = isLoading ? [] : resultsState.jobs;
  const hasMore = isLoading ? false : resultsState.hasMore;

  const loadMore = useCallback(() => {
    if (isLoading || isFetchingMore || !hasMore) return;
    setIsFetchingMore(true);
    fetchPage(jobs.length)
      .then((page) => {
        setResultsState((current) =>
          current
            ? {
                key: current.key,
                jobs: [...current.jobs, ...page.results],
                hasMore: page.hasMore,
              }
            : current,
        );
      })
      .catch(() => {
        setResultsState((current) =>
          current ? { ...current, hasMore: false } : current,
        );
      })
      .finally(() => setIsFetchingMore(false));
  }, [fetchPage, hasMore, isFetchingMore, isLoading, jobs.length]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const resetFilters = () => {
    setSearch("");
    setExperience([]);
    setVerifiedOnly(false);
    setLowProposalsOnly(false);
    setMinBudget(0);
    setMaxBudget(0);
    setSort("newest");
  };
  const filterProps = {
    experience,
    toggleExperience,
    verifiedOnly,
    setVerifiedOnly,
    lowProposalsOnly,
    setLowProposalsOnly,
    minBudget,
    setMinBudget,
    maxBudget,
    setMaxBudget,
    resetFilters,
  };

  return (
    <>
      <section className="border-b border-black/7 bg-[#e8f1e5]">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-18 lg:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5a7d58]">
            Fresh opportunities
          </p>
          <h1 className={`${styles.pageTitle} max-w-3xl`}>
            Find meaningful work with great clients.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#667064] sm:text-base">
            Explore recent projects from verified companies looking for
            independent expertise.
          </p>
          <label className="mt-8 flex max-w-2xl items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 focus-within:border-[#6e916b] focus-within:ring-3 focus-within:ring-white/60">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-[#7d827a]"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="10.8"
                cy="10.8"
                r="6.6"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="m16 16 4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <span className="sr-only">Search jobs</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-[#9a9e97]"
              placeholder="Search jobs by title, skill, or client"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs font-semibold text-[#62705f]"
              >
                Clear
              </button>
            )}
          </label>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <details className="mb-6 rounded-2xl border border-black/8 bg-white p-5 lg:hidden">
          <summary className="cursor-pointer list-none text-sm font-semibold">
            Filters
          </summary>
          <div className="mt-6">
            <FilterControls {...filterProps} />
          </div>
        </details>
        <div className="grid items-start gap-8 lg:grid-cols-[17rem_1fr]">
          <aside className="sticky top-24 hidden rounded-2xl border border-black/8 bg-white p-5 lg:block">
            <h2 className={`${styles.uiHeading} text-base`}>Filters</h2>
            <div className="mt-6">
              <FilterControls {...filterProps} />
            </div>
          </aside>
          <section>
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#6d716a]" aria-live="polite">
                {isLoading ? (
                  "Searching…"
                ) : (
                  <>
                    <strong className="text-[#272a26]">{jobs.length}</strong>{" "}
                    recent job posts
                  </>
                )}
              </p>
              <label className="flex items-center gap-3 text-sm text-[#6d716a]">
                Sort by
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-10 rounded-xl border border-black/10 bg-white px-3 font-medium text-[#3d413c] outline-none focus:border-[#668c63]"
                >
                  <option value="newest">Newest</option>
                  <option value="budget">Highest budget</option>
                  <option value="rating">Client rating</option>
                  <option value="proposals">Fewest proposals</option>
                </select>
              </label>
            </div>
            {isLoading ? (
              <div className="space-y-5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <JobCardSkeleton key={index} />
                ))}
              </div>
            ) : jobs.length ? (
              <>
                <div className="space-y-5">
                  {jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
                <div ref={sentinelRef} className="h-1" />
                {isFetchingMore && (
                  <p className="mt-6 text-center text-sm text-[#777b74]">
                    Loading more jobs…
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-black/15 bg-white px-6 py-16 text-center">
                <p className="text-lg font-semibold">No matching jobs found</p>
                <p className="mt-2 text-sm text-[#777b74]">
                  Try a broader search or reset your filters.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 rounded-xl bg-[#252724] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Reset filters
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
