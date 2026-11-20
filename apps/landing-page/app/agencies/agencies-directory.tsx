"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./agencies.module.css";
import Image from "next/image";

type Sort = "recommended" | "rating" | "projects" | "rate-low";

interface Agency {
  id: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  tagline: string | null;
  description: string;
  specialty: string;
  location: string | null;
  teamSize: string;
  memberCount: number;
  minHourlyRate: number | null;
  rating: number;
  reviews: number;
  projects: number;
  success: number;
  skills: string[];
}

const SEARCH_DEBOUNCE_MS = 700;
const RATE_CEILING = 500;

const specialties = [
  "Web & software development",
  "Design & creative",
  "Data & AI",
  "Marketing",
];
const teamSizes = [
  "2–5 members",
  "6–10 members",
  "11–25 members",
  "26+ members",
];

const AVATAR_COLORS = [
  "#577d73",
  "#466a7b",
  "#88715b",
  "#685f82",
  "#74805d",
  "#8b625e",
];

function colorFor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsFor(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="m6.4 10.1 2.2 2.2 5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AgencyCard({ agency }: { agency: Agency }) {
  const initials = useMemo(() => initialsFor(agency.name), [agency.name]);

  return (
    <article className="group flex flex-col rounded-2xl border border-black/8 bg-white p-6 transition hover:border-black/14">
      <div className="flex items-start gap-4">
        {agency.avatarUrl ? (
          <Image
            src={agency.avatarUrl}
            width={40}
            height={40}
            alt=""
            className="h-14 w-14 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-base font-semibold text-white"
            style={{ backgroundColor: colorFor(agency.id) }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`${styles.uiHeading} text-xl text-[#252824]`}>
              {agency.name}
            </h2>
            {agency.verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e7f2e4] px-2 py-1 text-[11px] font-semibold text-[#4c7649]">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#5a8357] text-white">
                  <CheckIcon />
                </span>
                Verified
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#737870]">
            {agency.location && `${agency.location} · `}
            {agency.memberCount} team member
            {agency.memberCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {agency.tagline && (
        <h3 className={`${styles.uiHeading} mt-6 text-lg leading-6`}>
          {agency.tagline}
        </h3>
      )}
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#686d66]">
        {agency.description}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {agency.skills.map((skill) => (
          <span
            key={skill}
            className="rounded-lg bg-[#eef2ec] px-2.5 py-1.5 text-xs font-medium text-[#596057]"
          >
            {skill}
          </span>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-y border-black/7 py-4 text-center">
        <div>
          <p className="text-base font-semibold">{agency.success}%</p>
          <p className="mt-1 text-[11px] text-[#858a82]">Job success</p>
        </div>
        <div className="border-x border-black/7">
          <p className="text-base font-semibold">{agency.projects}</p>
          <p className="mt-1 text-[11px] text-[#858a82]">Projects</p>
        </div>
        <div>
          <p className="text-base font-semibold text-[#d4a334]">
            ★ <span className="text-[#252824]">{agency.rating.toFixed(1)}</span>
          </p>
          <p className="mt-1 text-[11px] text-[#858a82]">
            {agency.reviews} review{agency.reviews === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-sm text-[#7a7f77]">
          {agency.minHourlyRate ? (
            <>
              From{" "}
              <strong className="text-base text-[#252824]">
                ${agency.minHourlyRate}
              </strong>
              /hr
            </>
          ) : (
            "Rate on request"
          )}
        </p>
        <Link
          href={`/agency/${agency.id}`}
          className="rounded-xl bg-[#252724] px-4 py-2.5 text-sm font-semibold text-white! transition group-hover:bg-[#3b3e39]"
        >
          View agency
        </Link>
      </div>
    </article>
  );
}

function AgencyCardSkeleton() {
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className={`h-14 w-14 shrink-0 rounded-2xl ${styles.shimmer}`} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className={`h-4 w-2/5 rounded-md ${styles.shimmer}`} />
          <div className={`h-3 w-1/2 rounded-md ${styles.shimmer}`} />
        </div>
      </div>
      <div className={`mt-6 h-4 w-3/5 rounded-md ${styles.shimmer}`} />
      <div className="mt-3 space-y-2">
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
      <div className="mt-6 grid grid-cols-3 gap-2 border-y border-black/7 py-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <div className={`h-4 w-10 rounded-md ${styles.shimmer}`} />
            <div className={`h-2.5 w-14 rounded-md ${styles.shimmer}`} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <div className={`h-4 w-20 rounded-md ${styles.shimmer}`} />
        <div className={`h-10 w-28 rounded-xl ${styles.shimmer}`} />
      </div>
    </article>
  );
}

export function AgenciesDirectory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [specialty, setSpecialty] = useState("All");
  const [sizes, setSizes] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [maxRate, setMaxRate] = useState(RATE_CEILING);
  const [sort, setSort] = useState<Sort>("recommended");

  const [resultsState, setResultsState] = useState<{
    key: string;
    agencies: Agency[];
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

  const toggleSize = (value: string) =>
    setSizes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        debouncedSearch,
        specialty,
        sizes,
        verifiedOnly,
        maxRate,
        sort,
      }),
    [debouncedSearch, specialty, sizes, verifiedOnly, maxRate, sort],
  );

  const fetchPage = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({
        query: debouncedSearch,
        sort,
        offset: String(offset),
      });
      if (specialty !== "All") params.set("specialty", specialty);
      if (sizes.length) params.set("sizes", sizes.join(","));
      if (verifiedOnly) params.set("verifiedOnly", "true");
      if (maxRate < RATE_CEILING) params.set("maxRate", String(maxRate));

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/search?${params.toString()}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Agency search failed.");
      }
      return result.data as { results: Agency[]; hasMore: boolean };
    },
    [debouncedSearch, sort, specialty, sizes, verifiedOnly, maxRate],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage(0)
      .then((page) => {
        if (cancelled) return;
        setResultsState({
          key: filterKey,
          agencies: page.results,
          hasMore: page.hasMore,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setResultsState({ key: filterKey, agencies: [], hasMore: false });
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, fetchPage]);

  const isLoading = resultsState === null || resultsState.key !== filterKey;
  const results = isLoading ? [] : resultsState.agencies;
  const hasMore = isLoading ? false : resultsState.hasMore;

  const loadMore = useCallback(() => {
    if (isLoading || isFetchingMore || !hasMore) return;
    setIsFetchingMore(true);
    fetchPage(results.length)
      .then((page) => {
        setResultsState((current) =>
          current
            ? {
                key: current.key,
                agencies: [...current.agencies, ...page.results],
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
  }, [fetchPage, hasMore, isFetchingMore, isLoading, results.length]);

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

  const reset = () => {
    setSearch("");
    setSpecialty("All");
    setSizes([]);
    setVerifiedOnly(false);
    setMaxRate(RATE_CEILING);
    setSort("recommended");
  };

  return (
    <main>
      <section className="border-b border-[#cdd7ca] bg-[#e9f2e6]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
          <p className="text-xs font-semibold tracking-[0.18em] text-[#5d825a] uppercase">
            Specialized teams, exceptional work
          </p>
          <h1 className={styles.pageTitle}>
            Find the right agency for your next big move.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-[#697068] sm:text-lg">
            Discover trusted studios and expert teams with the capabilities to
            take your project from first idea to measurable impact.
          </p>
          <label className="mt-10 flex h-16 max-w-3xl items-center gap-4 rounded-2xl border border-black/8 bg-white px-5 focus-within:border-[#789b74]">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-[#7b8178]"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="11"
                cy="11"
                r="6.5"
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by expertise, agency name, or location"
              className="h-full w-full bg-transparent text-base outline-none placeholder:text-[#a0a59d]"
            />
          </label>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-10">
        <aside>
          <div className="rounded-2xl border border-black/8 bg-white p-6 lg:sticky lg:top-28">
            <div className="flex items-center justify-between">
              <h2 className={`${styles.uiHeading} text-lg`}>Filters</h2>
              <button
                onClick={reset}
                className="cursor-pointer text-xs font-semibold text-[#52784f] hover:underline"
              >
                Reset
              </button>
            </div>

            <fieldset className="mt-7">
              <legend className="text-sm font-semibold">Expertise</legend>
              <div className="mt-4 grid gap-3">
                {["All", ...specialties].map((item) => (
                  <label
                    key={item}
                    className="flex cursor-pointer items-center gap-3 text-sm text-[#656a63]"
                  >
                    <input
                      type="radio"
                      name="specialty"
                      checked={specialty === item}
                      onChange={() => setSpecialty(item)}
                      className="h-4 w-4 accent-[#52784f]"
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7 border-t border-black/7 pt-6">
              <legend className="text-sm font-semibold">Team size</legend>
              <div className="mt-4 grid gap-3">
                {teamSizes.map((item) => (
                  <label
                    key={item}
                    className="flex cursor-pointer items-center gap-3 text-sm text-[#656a63]"
                  >
                    <input
                      type="checkbox"
                      checked={sizes.includes(item)}
                      onChange={() => toggleSize(item)}
                      className="h-4 w-4 rounded accent-[#52784f]"
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-7 border-t border-black/7 pt-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Hourly rate</p>
                <span className="text-xs font-semibold text-[#52784f]">
                  {maxRate >= RATE_CEILING ? "Any rate" : `Up to $${maxRate}`}
                </span>
              </div>
              <input
                type="range"
                min="25"
                max={RATE_CEILING}
                step="5"
                value={maxRate}
                onChange={(event) => setMaxRate(Number(event.target.value))}
                className="mt-4 w-full accent-[#52784f]"
              />
              <div className="mt-1 flex justify-between text-[11px] text-[#92968f]">
                <span>$25/hr</span>
                <span>$500+/hr</span>
              </div>
            </div>

            <label className="mt-7 flex cursor-pointer items-center gap-3 border-t border-black/7 pt-6 text-sm text-[#656a63]">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
                className="h-4 w-4 rounded accent-[#52784f]"
              />
              Verified agencies only
            </label>
          </div>
        </aside>

        <div>
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-sm text-[#777c75]">
              {isLoading ? (
                "Searching…"
              ) : (
                <>
                  <strong className="text-[#252824]">{results.length}</strong>{" "}
                  agencies ready to collaborate
                </>
              )}
            </p>
            <label className="flex items-center gap-3 text-sm text-[#777c75]">
              Sort by
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="h-11 rounded-xl border border-black/10 bg-white px-4 font-medium text-[#373a36] outline-none"
              >
                <option value="recommended">Recommended</option>
                <option value="rating">Top rated</option>
                <option value="projects">Most projects</option>
                <option value="rate-low">Rate: low to high</option>
              </select>
            </label>
          </div>

          {isLoading ? (
            <div className="grid gap-5 xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <AgencyCardSkeleton key={index} />
              ))}
            </div>
          ) : results.length ? (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                {results.map((agency) => (
                  <AgencyCard key={agency.id} agency={agency} />
                ))}
              </div>
              <div ref={sentinelRef} className="h-1" />
              {isFetchingMore && (
                <p className="mt-6 text-center text-sm text-[#777c75]">
                  Loading more agencies…
                </p>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-black/12 bg-white px-6 py-16 text-center">
              <h2 className={`${styles.uiHeading} text-xl`}>
                No agencies match those filters
              </h2>
              <p className="mt-2 text-sm text-[#777c75]">
                Try broadening your search or resetting the filters.
              </p>
              <button
                onClick={reset}
                className="mt-5 cursor-pointer text-sm font-semibold text-[#52784f] hover:underline"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
