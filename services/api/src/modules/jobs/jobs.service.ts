import { db } from "../../database/client.js";
import {
  deleteJobPostIfEditable,
  deleteSavedJob,
  findEditableJobPost,
  findJobPostsWithCounts,
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
} from "./jobs.repository.js";
import { ApiError } from "../../shared/http/api-error.js";
import { imageKit } from "../../infrastructure/image-kit.js";
import { env } from "../../config/env.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../infrastructure/upload-documents.js";
import { reuseStoredAttachments } from "../../shared/uploads/attachments.js";
import { clerk } from "../../infrastructure/clerk.js";

export type { PublicJobFilters } from "./jobs.repository.js";

export const createJobPost = async (userId: string, data: JobData) => {
  const { documents: attachments, uploadedIds } = await uploadDocuments(
    userId,
    data.attachments ?? [],
  );

  try {
    return await insertJobPost(db, {
      ...data,
      attachments,
      client_id: userId,
    });
  } catch (error) {
    await Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const getJobPosts = async (userId: string, jobId?: string) => {
  return findJobPostsWithCounts(db, userId, jobId);
};

export const updateJobPost = async (
  userId: string,
  jobId: string,
  data: JobUpdate,
) => {
  const existingJob = await findEditableJobPost(db, userId, jobId);

  if (!existingJob) throw new ApiError(404, "Editable job post not found.");

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
    throw new ApiError(404, "Editable job post not found.");
  }

  const retainedIds = new Set(attachments.map(({ fileId }) => fileId));
  await deleteDocuments(
    existingJob.attachments?.filter(({ fileId }) => !retainedIds.has(fileId)),
  );

  return job;
};

export const deleteJobPost = async (userId: string, jobId: string) => {
  const job = await deleteJobPostIfEditable(db, userId, jobId);

  if (!job) throw new ApiError(404, "Deleteable job post not found.");

  await deleteDocuments(job.attachments ?? []);
  return job;
};

export const saveJobPost = async (freelancerId: string, jobId: string) => {
  const job = await findPublishedJobId(db, jobId);
  if (!job) throw new ApiError(404, "Job post not found.");

  const savedJob = await insertSavedJobIfAbsent(db, freelancerId, jobId);

  if (savedJob) return savedJob;
  const existingSavedJob = await findSavedJob(db, freelancerId, jobId);
  return existingSavedJob!;
};

export const getSavedJobPosts = async (freelancerId: string) => {
  const rows = await findSavedJobRows(db, freelancerId);

  return rows.map(
    ({ job, savedAt, companyName, paymentVerified, proposalCount }) => ({
      ...job,
      savedAt,
      companyName,
      paymentVerified: paymentVerified === true,
      proposalCount,
    }),
  );
};

export const removeSavedJobPost = async (
  freelancerId: string,
  jobId: string,
) => {
  const savedJob = await deleteSavedJob(db, freelancerId, jobId);
  if (!savedJob) throw new ApiError(404, "Saved job post not found.");
  return savedJob;
};

export interface PublicJobSummary {
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

const PUBLIC_JOB_PAGE_SIZE = 20;
const jobRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const getPublicJobFeed = async (
  filters: PublicJobFilters,
  pagination: { limit?: number; offset?: number } = {},
): Promise<PublicJobFeedPage> => {
  const limit = pagination.limit ?? PUBLIC_JOB_PAGE_SIZE;
  const offset = pagination.offset ?? 0;
  const normalizedQuery = (filters.query ?? "").trim().toLowerCase();

  const rows = await findPublishedJobFeedRows(db, filters, { limit, offset });

  const hasMore = rows.length === limit;
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
