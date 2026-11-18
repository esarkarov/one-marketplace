import { db } from "../../../database/client.js";
import {
  countHiresForJob,
  countHiresPerJob,
  countProposalsForJob,
  countProposalsPerJob,
  findPublishedJobDetail,
  listPublishedJobsWithClient,
} from "../repositories/freelancer.jobs.repository.js";
import { findFreelancerSkills } from "../repositories/freelancer.repository.js";
import { JobFeedFilters } from "../types/freelancer.types.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { toJobPostResponse } from "../../jobs/index.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";

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
// picker) vs "Next.js" (job post skill tag) — both normalize to "nextjs".
const normalizeSkill = (skill: string) =>
  skill.toLowerCase().replace(/[^a-z0-9]/g, "");

// Shared by both the freelancer and agency job feeds — "skills" is either a
// freelancer's own skills or an agency's tags, matched against each job's
// required skills and title/description text the same way either side.
const matchJobPostsBySkills = async (
  skillList: string[],
  filters: JobFeedFilters = {},
) => {
  const skills = skillList.map(normalizeSkill);

  const jobs = await listPublishedJobsWithClient(db);

  const proposalCounts = await countProposalsPerJob(db);
  const hireCounts = await countHiresPerJob(db);

  const counts = new Map(
    proposalCounts?.map((item) => [item.jobId, Number(item.count)]),
  );
  const hires = new Map(
    hireCounts.map((item) => [item.jobId, Number(item.count)]),
  );

  const filteredJobs = jobs
    .map(
      ({
        job,
        clientAccountId,
        companyName,
        clientCountry,
        paymentVerified,
        totalSpentCents,
        clientRating,
        clientReviewCount,
      }) => ({
        ...job,
        clientAccountId,
        companyName,
        clientCountry,
        paymentVerified: paymentVerified === true,
        proposalCount: counts?.get(job.id) ?? 0,
        hireCount: hires.get(job.id) ?? 0,
        clientTotalSpentCents: totalSpentCents ?? 0,
        clientRating: Number(clientRating ?? 0),
        clientReviewCount: Number(clientReviewCount ?? 0),
      }),
    )
    .filter((job) => {
      const budgetCents = job.total_budget_cents;
      return (
        (!filters.levels?.length ||
          filters.levels.includes(job.expertise_level)) &&
        (!filters.durations?.length ||
          filters.durations.includes(job.expected_duration)) &&
        (filters.minBudgetCents === undefined ||
          budgetCents >= filters.minBudgetCents) &&
        (filters.maxBudgetCents === undefined ||
          budgetCents <= filters.maxBudgetCents) &&
        (filters.minProposals === undefined ||
          job.proposalCount >= filters.minProposals) &&
        (filters.maxProposals === undefined ||
          job.proposalCount <= filters.maxProposals) &&
        (!filters.paymentVerified || job.paymentVerified)
      );
    });

  if (filters.sort === "recent") return filteredJobs;

  return filteredJobs
    .map((job) => {
      const jobSkills = job.skills.map(normalizeSkill);
      const content = normalizeSkill(`${job.title} ${job.description}`);
      const skillMatches = skills.filter((skill) =>
        jobSkills.some(
          (jobSkill) => jobSkill === skill || jobSkill.includes(skill),
        ),
      ).length;
      const contentMatches = skills.filter((skill) =>
        content.includes(skill),
      ).length;

      return { ...job, matchScore: skillMatches * 2 + contentMatches };
    })
    .filter((job) => job.matchScore > 0)
    .sort(
      (first, second) =>
        second.matchScore - first.matchScore ||
        new Date(second.published_at ?? second.created_at ?? 0).getTime() -
          new Date(first.published_at ?? first?.created_at ?? 0).getTime() ||
        compareIdsDescending(first.id, second.id),
    );
};

const compareIdsDescending = (first: string, second: string) =>
  first < second ? 1 : first > second ? -1 : 0;

export const getMatchedJobPostsBySkills = async (
  skillList: string[],
  filters: JobFeedFilters,
  { limit, offset }: { limit: number; offset: number },
  operation: string,
) => {
  const matched = await matchJobPostsBySkills(skillList, filters);
  const { rows, hasMore } = toOffsetPage(
    matched.slice(offset, offset + fetchSize(limit)),
    limit,
  );

  return {
    results: rows.map(({ clientAccountId, clientCountry, ...job }) => ({
      ...toJobPostResponse(job, clientAccountId, operation),
      clientCountry: clientCountry ?? null,
    })),
    hasMore,
  };
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
