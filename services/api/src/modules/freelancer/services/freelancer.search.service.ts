import { db } from "@/database/client.js";
import { PAGINATION } from "@/shared/validation/constants/pagination.constants.js";
import {
  fetchSize,
  toOffsetPage,
} from "@/shared/validation/utils/pagination.utils.js";
import { searchFreelancerRows } from "@/modules/freelancer/repositories/freelancer.search.repository.js";
import {
  PublicTalentSummary,
  PublicTalentSearchFilters,
  PublicTalentSearchPage,
} from "@/modules/freelancer/types/freelancer.types.js";
import { findAccountDisplays } from "@/modules/auth/index.js";
import { countryDisplayName } from "@/shared/search/search-text.js";

export const searchPublicFreelancers = async (
  filters: PublicTalentSearchFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicTalentSearchPage> => {
  const limit = pagination.limit ?? PAGINATION.defaultLimit;
  const offset = pagination.offset ?? 0;

  const { rows, hasMore } = toOffsetPage(
    await searchFreelancerRows(db, filters, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  if (!rows.length) return { results: [], hasMore: false };

  const displays = await findAccountDisplays(rows.map((row) => row.authId));

  const results: PublicTalentSummary[] = [];
  rows.forEach((row) => {
    const display = displays.get(row.authId);
    const name = display?.displayName || "Freelancer";
    const countryName = row.country ? countryDisplayName(row.country) : null;
    const location =
      [row.city, countryName].filter(Boolean).join(", ") ||
      "Location unavailable";

    results.push({
      id: row.id,
      name,
      avatarUrl: display?.avatarUrl || null,
      title: row.professionalTitle || "Freelancer",
      location,
      verified: row.identityVerified === true,
      active: row.availabilityStatus === "AVAILABLE",
      jobSuccess: Math.round(Number(row.jobSuccessScore ?? 0)),
      completedProjects: Number(row.completedJobs ?? 0),
      rating: Number(row.rating ?? 0),
      reviews: Number(row.reviewCount ?? 0),
      hourlyRateCents: row.hourlyRateCents,
      skills: row.skills,
      summary: row.professionalDescription,
    });
  });

  return { results, hasMore };
};
