import { db } from "../../../database/client.js";
import { searchFreelancerRows } from "../repositories/freelancer.search.repository.js";
import {
  PublicTalentSummary,
  PublicTalentSearchFilters,
  PublicTalentSearchPage,
} from "../types/freelancer.types.js";
import { env } from "../../../config/env.js";
import { clerk } from "../../../infrastructure/clerk.js";

const PUBLIC_TALENT_PAGE_SIZE = 20;

const publicTalentRegionNames = new Intl.DisplayNames(["en"], {
  type: "region",
});

export const searchPublicFreelancers = async (
  filters: PublicTalentSearchFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicTalentSearchPage> => {
  const limit = pagination.limit ?? PUBLIC_TALENT_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const rows = await searchFreelancerRows(db, filters, { limit, offset });

  const hasMore = rows.length === limit;
  if (!rows.length || !env.clerkSecretKey)
    return { results: [], hasMore: false };

  const clerkUsers = await Promise.all(
    rows.map(async (row) => {
      try {
        return await clerk.users.getUser(row.authId);
      } catch {
        return null;
      }
    }),
  );

  const results: PublicTalentSummary[] = [];
  rows.forEach((row, index) => {
    const user = clerkUsers[index];
    const name = user?.fullName ?? "Freelancer";
    const countryName = row.country
      ? (publicTalentRegionNames.of(row.country) ?? row.country)
      : null;
    const location =
      [row.city, countryName].filter(Boolean).join(", ") ||
      "Location unavailable";
    const searchable = [name, row.professionalTitle, location, ...row.skills]
      .join(" ")
      .toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return;

    results.push({
      id: row.id,
      name,
      avatarUrl: user?.imageUrl || null,
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
