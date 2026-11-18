import { db } from "../../../database/client.js";
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
} from "../repositories/jobs.repository.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { imageKit } from "../../../infrastructure/storage/image-kit.client.js";
import { env } from "../../../config/env.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../../shared/uploads/upload-documents.js";
import { reuseStoredAttachments } from "../../../shared/uploads/attachments.js";
import { PAGINATION } from "../../../shared/validation/constants/pagination.constants.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";
import { clerk } from "../../../infrastructure/auth/clerk.client.js";
import {
  toJobPostResponse,
  toSavedJobLinkResponse,
} from "../utils/jobs.mappers.js";

export type { PublicJobFilters } from "../repositories/jobs.repository.js";

export const createJobPost = async (userId: string, data: JobData) => {
  const { documents: attachments, uploadedIds } = await uploadDocuments(
    userId,
    data.attachments ?? [],
  );

  try {
    const job = await insertJobPost(db, {
      ...data,
      attachments,
      client_id: userId,
    });
    return job && toJobPostResponse(job);
  } catch (error) {
    await Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const getJobPosts = async (userId: string, jobId?: string) => {
  const jobs = await findJobPostsWithCounts(db, userId, jobId);
  return jobs.map(toJobPostResponse);
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
  return { results: rows.map(toJobPostResponse), hasMore };
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

  const { documents: attachments, uploadedIds } = await uploadDocuments(
    userId,
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

  return toJobPostResponse(job);
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

  if (savedJob) return toSavedJobLinkResponse(savedJob);
  const existingSavedJob = await findSavedJob(db, freelancerId, jobId);
  return toSavedJobLinkResponse(existingSavedJob!);
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
      ({ job, savedAt, companyName, paymentVerified, proposalCount }) => ({
        ...toJobPostResponse(job),
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
  return toSavedJobLinkResponse(savedJob);
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

const jobRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const getPublicJobFeed = async (
  filters: PublicJobFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicJobFeedPage> => {
  const limit = pagination.limit ?? PAGINATION.defaultLimit;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const { rows, hasMore } = toOffsetPage(
    await findPublishedJobFeedRows(db, filters, {
      limit: fetchSize(limit),
      offset,
    }),
    limit,
  );
  if (!rows.length) return { results: [], hasMore: false };

  const clientCountries = new Map<string, string | null>();
  if (env.clerkSecretKey) {
    const uniqueClientIds = [...new Set(rows.map((row) => row.job.client_id))];
    await Promise.all(
      uniqueClientIds.map(async (clientId) => {
        try {
          const user = await clerk.users.getUser(clientId);
          const country = user.unsafeMetadata.country;
          clientCountries.set(
            clientId,
            typeof country === "string" ? country : null,
          );
        } catch {
          clientCountries.set(clientId, null);
        }
      }),
    );
  }

  const results: PublicJobSummary[] = [];
  for (const row of rows) {
    const countryCode = clientCountries.get(row.job.client_id) ?? null;
    const clientLocation = countryCode
      ? (jobRegionNames.of(countryCode) ?? countryCode)
      : null;
    const searchable = [
      row.job.title,
      row.job.description,
      row.companyName,
      ...row.job.skills,
    ]
      .join(" ")
      .toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;

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
