import { db } from "@/database/client.js";
import {
  countHiresForJob,
  countProposalsForJob,
  findPublishedJobDetail,
  listBestMatchJobIds,
  listFeedJobsByIds,
  listRecentJobIds,
} from "@/modules/freelancer/repositories/freelancer.jobs.repository.js";
import { findFreelancerSkills } from "@/modules/freelancer/repositories/freelancer.repository.js";
import { JobFeedFilters } from "@/modules/freelancer/types/freelancer.types.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { toJobPostResponse } from "@/modules/jobs/index.js";
import { toOffsetPage } from "@/shared/validation/utils/pagination.utils.js";

export const getJSSContribution = (rating: number): number => {
  const r = Math.round(rating);
  if (r >= 5) return 100;
  if (r === 4) return 90;
  if (r === 3) return 75;
  if (r === 2) return 60;
  if (r === 1) return 50;
  return 0;
};

// Strips spacing/punctuation so equivalent skill names entered through
// different UI conventions still match, e.g. "Next Js" (freelancer skill
// picker) vs "Next.js" (job post skill tag) both normalize to "nextjs". The SQL
// applies the same rule to the job side (ADR 0022).
const normalizeSkill = (skill: string) =>
  skill.toLowerCase().replace(/[^a-z0-9]/g, "");

const toFeedPage = async (
  fetched: Array<{ id: string; score?: number }>,
  limit: number,
  operation: string,
) => {
  const { rows: pageRows, hasMore } = toOffsetPage(fetched, limit);
  const jobs = await listFeedJobsByIds(
    db,
    pageRows.map((row) => row.id),
  );
  const byId = new Map(jobs.map((row) => [row.job.id, row]));

  return {
    results: pageRows.flatMap(({ id, score }) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          ...toJobPostResponse(
            {
              ...row.job,
              companyName: row.companyName,
              paymentVerified: row.paymentVerified === true,
              proposalCount: row.proposalCount,
              hireCount: row.hireCount,
              clientTotalSpentCents: row.totalSpentCents ?? 0,
              clientRating: Number(row.clientRating ?? 0),
              clientReviewCount: Number(row.clientReviewCount ?? 0),
              ...(score === undefined ? {} : { matchScore: score }),
            },
            row.clientAccountId,
            operation,
          ),
          clientCountry: row.clientCountry ?? null,
        },
      ];
    }),
    hasMore,
  };
};

// Shared by both the freelancer and agency job feeds: "skillList" is either a
// freelancer's own skills or an agency's tags, matched in SQL against each
// job's required skills and title/description text.
export const getMatchedJobPostsBySkills = async (
  skillList: string[],
  filters: JobFeedFilters,
  { limit, offset }: { limit: number; offset: number },
  operation: string,
) => {
  if (filters.sort === "recent") {
    const ids = await listRecentJobIds(db, filters, { limit, offset });
    return toFeedPage(
      ids.map((id) => ({ id })),
      limit,
      operation,
    );
  }

  const matched = await listBestMatchJobIds(
    db,
    filters,
    skillList.map(normalizeSkill),
    { limit, offset },
  );
  return toFeedPage(
    matched.map(({ id, score }) => ({ id, score })),
    limit,
    operation,
  );
};

export const getMatchedJobPosts = async (
  userId: string,
  filters: JobFeedFilters,
  page: { limit: number; offset: number },
) => {
  const profile = await findFreelancerSkills(db, userId);

  if (!profile) throw new ApiError(404, "Freelancer profile not found.");

  return getMatchedJobPostsBySkills(
    profile.skills,
    filters,
    page,
    "freelancer_get_jobs",
  );
};

export const getFreelancerJobPost = async (jobId: string) => {
  const result = await findPublishedJobDetail(db, jobId);

  if (!result) throw new ApiError(404, "Job post not found.");

  const proposalTotal = await countProposalsForJob(db, jobId);
  const hireTotal = await countHiresForJob(db, jobId);

  return {
    ...toJobPostResponse(
      result.job,
      result.clientAccountId,
      "freelancer_get_jobs_by_id",
    ),
    companyName: result.companyName,
    companyDescription: result.companyDescription,
    clientCountry: result.clientCountry ?? null,
    paymentVerified: result.paymentVerified === true,
    clientJoinedAt: result.clientJoinedAt,
    proposalCount: Number(proposalTotal?.count ?? 0),
    hireCount: Number(hireTotal?.count ?? 0),
    clientTotalSpentCents: result.totalSpentCents ?? 0,
    clientRating: Number(result.clientRating ?? 0),
    clientReviewCount: Number(result.clientReviewCount ?? 0),
  };
};
