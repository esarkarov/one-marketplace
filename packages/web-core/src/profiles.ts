import type { Components } from "@onemarketplace/api-client";
import {
  errorMessage,
  formatCents,
  isApiError,
} from "@onemarketplace/api-client";
import { isHttpsUrl } from "./url";

export type TalentProfile = Components["schemas"]["FreelancerPublicProfile"];
export type AgencyProfile = Components["schemas"]["PublicAgencyProfile"];
export type AgencyMember = AgencyProfile["members"][number];
export type WorkEntry = AgencyProfile["workHistory"][number];
export type OngoingEntry = Pick<
  WorkEntry,
  "id" | "title" | "client" | "amountCents"
> & { createdAt?: string | null };

export const WORK_HISTORY_PAGE_SIZE = 2;
export const ONGOING_PAGE_SIZE = 3;
export const MEMBERS_COLLAPSED_COUNT = 4;
export const NOT_AVAILABLE = "N/A";

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
}

export const paginate = <T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): Page<T> => {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1),
    totalPages,
  );
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page,
    totalPages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
};

export interface CompletedWork {
  id: string;
  project: string;
  client: string;
  completed: string;
  budget: string;
  rating: string;
  review: string;
}

export const formatMonthYear = (
  iso: string | null | undefined,
  fallback: string,
): string => {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

export const completedWork = (
  workHistory: readonly WorkEntry[],
): CompletedWork[] =>
  workHistory
    .filter(
      (job) =>
        job.status === "COMPLETED" &&
        job.clientHasReviewed &&
        job.freelancerHasReviewed &&
        job.rating !== null,
    )
    .map((job) => ({
      id: job.id,
      project: job.title,
      client: job.client,
      completed: formatMonthYear(job.completed, "Recently"),
      budget: formatCents(job.amountCents),
      rating: (job.rating ?? 0).toFixed(1),
      review: job.review ?? "",
    }));

export const ongoingWork = <T extends { status: WorkEntry["status"] }>(
  workHistory: readonly T[],
): T[] => workHistory.filter((job) => job.status === "ACTIVE");

export const ongoingStarted = (entry: OngoingEntry): string =>
  formatMonthYear(entry.createdAt, "recently");

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";

export const safeHttpsUrl = (
  value: string | null | undefined,
): string | null => (value && isHttpsUrl(value) ? value : null);

export const talentLocation = (
  profile: Pick<TalentProfile, "city" | "country">,
  countryName: (code: string) => string | undefined,
): string => {
  const country = countryName(profile.country) ?? profile.country;
  return [profile.city, country].filter(Boolean).join(", ");
};

export const talentProjectCount = (profile: TalentProfile): number =>
  profile.workHistory.length ||
  profile.stats.completedJobs + profile.stats.ongoingJobs;

export const formatHourlyRate = (cents: number): string =>
  `${formatCents(cents)}/hr`;

export const formatRating = (rating: number | null): string =>
  rating === null ? NOT_AVAILABLE : rating.toFixed(1);

export const formatJobSuccess = (score: number): string =>
  score > 0 ? `${Math.round(score)}%` : NOT_AVAILABLE;

export const profileErrorMessage = (error: unknown): string => {
  const message = errorMessage(error);
  return isApiError(error) && error.requestId
    ? `${message} (reference ${error.requestId})`
    : message;
};

export const isProfileNotFound = (error: unknown): boolean =>
  isApiError(error) && error.status === 404;
