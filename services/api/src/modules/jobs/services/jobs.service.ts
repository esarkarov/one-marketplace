import { db } from "@/database/client.js";
import {
  deleteJobPostIfEditable,
  deleteSavedJob,
  findEditableJobPost,
  findJobPostsWithCounts,
  findOwnedJobStatus,
  findPublishedJobFeedRows,
  findPublishedJobId,
  findSavedJob,
  findSavedJobRows,
  insertJobPost,
  insertSavedJobIfAbsent,
  updateJobPostIfEditable,
  type JobData,
  type JobUpdate,
  type PublicJobFilters,
} from "@/modules/jobs/repositories/jobs.repository.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { findAccountIdByAuthId } from "@/modules/auth/index.js";
import { imageKit } from "@/infrastructure/storage/image-kit.client.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "@/shared/uploads/upload-documents.js";
import { reuseStoredAttachments } from "@/shared/uploads/attachments.js";
import { requirePublicId } from "@/shared/ids/public-ids.js";
import { jobAttachmentFolder } from "@/shared/uploads/storage-paths.js";
import { PAGINATION } from "@/shared/validation/constants/pagination.constants.js";
import {
  fetchSize,
  toOffsetPage,
} from "@/shared/validation/utils/pagination.utils.js";
import { countryDisplayName } from "@/shared/search/search-text.js";
import {
  toJobPostResponse,
  toSavedJobLinkResponse,
} from "@/modules/jobs/utils/jobs.mappers.js";

export type { PublicJobFilters } from "@/modules/jobs/repositories/jobs.repository.js";

export const createJobPost = async (userId: string, data: JobData) => {
  const clientAccountId = await findAccountIdByAuthId(db, userId);
  const { documents: attachments, uploadedIds } = await uploadDocuments(
    jobAttachmentFolder(requirePublicId(clientAccountId, "jobs_post", userId)),
    data.attachments ?? [],
  );

  try {
    const job = await insertJobPost(db, {
      ...data,
      attachments,
      client_id: userId,
    });
    return job && toJobPostResponse(job, clientAccountId, "jobs_post");
  } catch (error) {
    await Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const getJobPosts = async (userId: string, jobId?: string) => {
  const jobs = await findJobPostsWithCounts(db, userId, jobId);
  return jobs.map(({ clientAccountId, ...job }) =>
    toJobPostResponse(
      job,
      clientAccountId,
      jobId ? "jobs_get_by_job_id" : "jobs_get",
    ),
  );
};

export const getJobPostsPage = async (
  userId: string,
  { limit, offset }: { limit: number; offset: number },
) => {
  const { rows, hasMore } = toOffsetPage(
    await findJobPostsWithCounts(db, userId, undefined, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  return {
    results: rows.map(({ clientAccountId, ...job }) =>
      toJobPostResponse(job, clientAccountId, "jobs_get"),
    ),
    hasMore,
  };
};

const jobNotEditable = async (
  userId: string,
  jobId: string,
  message: string,
) => {
  const owned = await findOwnedJobStatus(db, userId, jobId);
  return owned?.status === "HIRED"
    ? new ApiError(
        409,
        "This job has a hire and can no longer be changed.",
        "JOB_LOCKED",
      )
    : new ApiError(404, message);
};

export const updateJobPost = async (
  userId: string,
  jobId: string,
  data: JobUpdate,
) => {
  const existingJob = await findEditableJobPost(db, userId, jobId);

  if (!existingJob) {
    throw await jobNotEditable(userId, jobId, "Editable job post not found.");
  }

  const clientAccountId = await findAccountIdByAuthId(db, userId);
  const { documents: attachments, uploadedIds } = await uploadDocuments(
    jobAttachmentFolder(
      requirePublicId(clientAccountId, "jobs_put_by_job_id", jobId),
    ),
    reuseStoredAttachments(
      existingJob.attachments ?? [],
      data.attachments ?? [],
    ),
  );

  const cleanupUploads = () =>
    Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );

  let job;

  try {
    job = await updateJobPostIfEditable(db, userId, jobId, data, attachments);
  } catch (error) {
    await cleanupUploads();
    throw error;
  }

  if (!job) {
    await cleanupUploads();
    throw await jobNotEditable(userId, jobId, "Editable job post not found.");
  }

  const retainedIds = new Set(attachments.map(({ fileId }) => fileId));
  await deleteDocuments(
    existingJob.attachments?.filter(({ fileId }) => !retainedIds.has(fileId)),
  );

  return toJobPostResponse(job, clientAccountId, "jobs_put_by_job_id");
};

export const deleteJobPost = async (userId: string, jobId: string) => {
  const job = await deleteJobPostIfEditable(db, userId, jobId);

  if (!job) {
    throw await jobNotEditable(userId, jobId, "Deleteable job post not found.");
  }

  await deleteDocuments(job.attachments ?? []);
  return job;
};

export const saveJobPost = async (freelancerId: string, jobId: string) => {
  const job = await findPublishedJobId(db, jobId);
  if (!job) throw new ApiError(404, "Job post not found.");

  const savedJob = await insertSavedJobIfAbsent(db, freelancerId, jobId);

  const accountId = await findAccountIdByAuthId(db, freelancerId);
  if (savedJob) {
    return toSavedJobLinkResponse(
      savedJob,
      accountId,
      "jobs_post_saved_by_job_id",
    );
  }
  const existingSavedJob = await findSavedJob(db, freelancerId, jobId);
  return toSavedJobLinkResponse(
    existingSavedJob!,
    accountId,
    "jobs_post_saved_by_job_id",
  );
};

export const getSavedJobPosts = async (
  freelancerId: string,
  { limit, offset }: { limit: number; offset: number },
) => {
  const { rows, hasMore } = toOffsetPage(
    await findSavedJobRows(db, freelancerId, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );

  return {
    results: rows.map(
      ({
        job,
        clientAccountId,
        savedAt,
        companyName,
        paymentVerified,
        proposalCount,
      }) => ({
        ...toJobPostResponse(job, clientAccountId, "jobs_get_saved"),
        savedAt,
        companyName,
        paymentVerified: paymentVerified === true,
        proposalCount,
      }),
    ),
    hasMore,
  };
};

export const removeSavedJobPost = async (
  freelancerId: string,
  jobId: string,
) => {
  const savedJob = await deleteSavedJob(db, freelancerId, jobId);
  if (!savedJob) throw new ApiError(404, "Saved job post not found.");
  return savedJob;
};

interface PublicJobSummary {
  id: string;
  title: string;
  description: string;
  skills: string[];
  totalBudgetCents: number;
  expectedDuration: string;
  expertiseLevel: string;
  publishedAt: Date | null;
  companyName: string;
  clientLocation: string | null;
  paymentVerified: boolean;
  clientRating: number;
  clientTotalSpentCents: number;
  proposalCount: number;
}

export interface PublicJobFeedPage {
  results: PublicJobSummary[];
  hasMore: boolean;
}

export const getPublicJobFeed = async (
  filters: PublicJobFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicJobFeedPage> => {
  const limit = pagination.limit ?? PAGINATION.defaultLimit;
  const offset = pagination.offset ?? 0;

  const { rows, hasMore } = toOffsetPage(
    await findPublishedJobFeedRows(db, filters, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  if (!rows.length) return { results: [], hasMore: false };

  const results: PublicJobSummary[] = [];
  for (const row of rows) {
    const clientLocation = row.clientCountry
      ? countryDisplayName(row.clientCountry)
      : null;

    results.push({
      id: row.job.id,
      title: row.job.title,
      description: row.job.description,
      skills: row.job.skills,
      totalBudgetCents: row.job.total_budget_cents,
      expectedDuration: row.job.expected_duration,
      expertiseLevel: row.job.expertise_level,
      publishedAt: row.job.published_at,
      companyName: row.companyName,
      clientLocation,
      paymentVerified: row.paymentVerified === true,
      clientRating: Number(row.clientRating ?? 0),
      clientTotalSpentCents: row.totalSpentCents ?? 0,
      proposalCount: Number(row.proposalCount),
    });
  }

  return { results, hasMore };
};
