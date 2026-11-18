import { db } from "../../../database/client.js";
import { toSafeCents } from "../../../shared/money/money.js";
import { PAGINATION } from "../../../shared/validation/constants/pagination.constants.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";
import { searchAgencyRows } from "../repositories/agency.search.repository.js";
import {
  PublicAgencySummary,
  PublicAgencyFilters,
  PublicAgencyFeedPage,
} from "../types/agency.types.js";

import { countryDisplayName } from "../../../shared/search/search-text.js";

export const searchPublicAgencies = async (
  filters: PublicAgencyFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicAgencyFeedPage> => {
  const limit = pagination.limit ?? PAGINATION.defaultLimit;
  const offset = pagination.offset ?? 0;

  const { rows, hasMore } = toOffsetPage(
    await searchAgencyRows(db, filters, { limit: fetchSize(limit), offset }),
    limit,
  );
  if (!rows.length) return { results: [], hasMore: false };

  const results: PublicAgencySummary[] = [];
  for (const row of rows) {
    const countryName = row.ownerCountry
      ? countryDisplayName(row.ownerCountry)
      : null;
    const location = [row.ownerCity, countryName].filter(Boolean).join(", ");

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
