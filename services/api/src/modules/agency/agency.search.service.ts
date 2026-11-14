import { db } from "../../database/client.js";
import { toSafeCents } from "../../shared/money/money.js";
import { searchAgencyRows } from "./agency.search.repository.js";

export interface PublicAgencySummary {
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
  minHourlyRateCents: number | null;
  rating: number;
  reviews: number;
  projects: number;
  success: number;
  skills: string[];
}

export interface PublicAgencyFilters {
  query?: string;
  specialty?: string;
  sizes?: string[];
  verifiedOnly?: boolean;
  maxRateCents?: number;
  sort?: "recommended" | "rating" | "projects" | "rate-low";
}

export interface PublicAgencyFeedPage {
  results: PublicAgencySummary[];
  hasMore: boolean;
}

const PUBLIC_AGENCY_PAGE_SIZE = 20;
const publicAgencyRegionNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

export const searchPublicAgencies = async (
  filters: PublicAgencyFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicAgencyFeedPage> => {
  const limit = pagination.limit ?? PUBLIC_AGENCY_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const rows = await searchAgencyRows(db, filters, { limit, offset });

  const hasMore = rows.length === limit;
  if (!rows.length) return { results: [], hasMore: false };

  const results: PublicAgencySummary[] = [];
  for (const row of rows) {
    const countryName = row.ownerCountry
      ? (publicAgencyRegionNames.of(row.ownerCountry) ?? row.ownerCountry)
      : null;
    const location = [row.ownerCity, countryName].filter(Boolean).join(", ");
    const searchable = [
      row.name,
      row.professionalTitle,
      row.specialty,
      location,
      ...row.tags,
    ]
      .join(" ")
      .toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;

    results.push({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatarImage?.url ?? null,
      verified: row.identityVerified === true,
      tagline: row.professionalTitle,
      description: row.overview,
      specialty: row.specialty,
      location: location || null,
      teamSize: row.size,
      memberCount: Number(row.memberCount),
      minHourlyRateCents:
        row.minHourlyRateCents !== null
          ? toSafeCents(row.minHourlyRateCents)
          : null,
      rating: Number(row.rating ?? 0),
      reviews: Number(row.reviewCount ?? 0),
      projects: Number(row.completedJobs ?? 0),
      success: Math.round(Number(row.jobSuccessScore ?? 0)),
      skills: row.tags,
    });
  }

  return { results, hasMore };
};
