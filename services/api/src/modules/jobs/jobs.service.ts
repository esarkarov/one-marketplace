import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { db } from "../../database/client.js";
import {
  accounts,
  client_metadata,
  client_spents,
  contracts,
  freelancer_saved_job_posts,
  job_posts,
  proposals,
} from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import { imageKit } from "../../config/imageKit.js";
import { env } from "../../config/env.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../utils/upload-documents.js";
import { createClerkClient } from "@clerk/backend";

type JobData = Omit<typeof job_posts.$inferInsert, "client_id">;

export const createJobPost = async (userId: string, data: JobData) => {
  const { documents: attachments, uploadedIds } = await uploadDocuments(
    userId,
    data.attachments ?? [],
  );

  try {
    const [job] = await db
      .insert(job_posts)
      .values({
        ...data,
        attachments,
        client_id: userId,
      })
      .returning();
    return job;
  } catch (error) {
    await Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw error;
  }
};

export const getJobPosts = async (userId: string, jobId?: string) => {
  return db
    .select({
      ...getTableColumns(job_posts),
      milestones: job_posts.milestones,
      proposalCount: count(proposals.id).mapWith(Number),
      shortlistCount: count(
        sql`nullif(${proposals.is_shortlisted}, false)`,
      ).mapWith(Number),
      hireCount: sql<number>`(
        SELECT count(*)
        FROM ${contracts}
        WHERE ${contracts.job_id} = ${job_posts.id}
          AND ${contracts.status} IN ('ACTIVE', 'COMPLETED')
      )`.mapWith(Number),
    })
    .from(job_posts)
    .leftJoin(proposals, eq(proposals.job_id, job_posts.id))
    .where(
      jobId
        ? and(eq(job_posts.client_id, userId), eq(job_posts.id, jobId))
        : eq(job_posts.client_id, userId),
    )
    .groupBy(job_posts.id)
    .orderBy(desc(job_posts.created_at));
};

export const updateJobPost = async (
  userId: string,
  jobId: string,
  data: Partial<typeof job_posts.$inferInsert>,
) => {
  const [existingJob] = await db
    .select()
    .from(job_posts)
    .where(
      and(
        eq(job_posts.id, jobId),
        eq(job_posts.client_id, userId),
        ne(job_posts.status, "HIRED"),
      ),
    )
    .limit(1);

  if (!existingJob) throw new ApiError(404, "Editable job post not found.");

  const { documents: attachments, uploadedIds } = await uploadDocuments(
    userId,
    data.attachments ?? [],
  );

  let job;

  try {
    [job] = await db
      .update(job_posts)
      .set({ ...data, updated_at: new Date() })
      .where(
        and(
          eq(job_posts.id, jobId),
          eq(job_posts.client_id, userId),
          ne(job_posts.status, "HIRED"),
        ),
      )
      .returning();
  } catch {}

  if (!job) {
    await Promise.allSettled(
      uploadedIds.map((fileId) => imageKit.files.delete(fileId)),
    );
    throw new ApiError(404, "Editable job post not found.");
  }

  const retainedIds = new Set(attachments.map(({ fileId }) => fileId));
  await deleteDocuments(
    existingJob.attachments?.filter(({ fileId }) => !retainedIds.has(fileId)),
  );

  return job;
};

export const deleteJobPost = async (userId: string, jobId: string) => {
  const [job] = await db
    .delete(job_posts)
    .where(
      and(
        eq(job_posts.id, jobId),
        eq(job_posts.client_id, userId),
        ne(job_posts.status, "HIRED"),
      ),
    )
    .returning();

  if (!job) throw new ApiError(404, "Deleteable job post not found.");

  await deleteDocuments(job.attachments ?? []);
  return job;
};

export const saveJobPost = async (freelancerId: string, jobId: string) => {
  const [job] = await db
    .select({ id: job_posts.id })
    .from(job_posts)
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);
  if (!job) throw new ApiError(404, "Job post not found.");

  const [savedJob] = await db
    .insert(freelancer_saved_job_posts)
    .values({
      freelancer_id: freelancerId,
      job_id: jobId,
    })
    .onConflictDoNothing()
    .returning();

  if (savedJob) return savedJob;
  const [existingSavedJob] = await db
    .select()
    .from(freelancer_saved_job_posts)
    .where(
      and(
        eq(freelancer_saved_job_posts.freelancer_id, freelancerId),
        eq(freelancer_saved_job_posts.job_id, jobId),
      ),
    )
    .limit(1);
  return existingSavedJob!;
};

export const getSavedJobPosts = async (freelancerId: string) => {
  const rows = await db
    .select({
      job: job_posts,
      savedAt: freelancer_saved_job_posts.created_at,
      companyName: client_metadata.company_name,
      paymentVerified: accounts.paymentMethodVerified,
      proposalCount: sql<number>`(
        SELECT count(*) FROM ${proposals}
        WHERE ${proposals.job_id} = ${job_posts.id}
      )`.mapWith(Number),
    })
    .from(freelancer_saved_job_posts)
    .innerJoin(job_posts, eq(freelancer_saved_job_posts.job_id, job_posts.id))
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .where(eq(freelancer_saved_job_posts.freelancer_id, freelancerId))
    .orderBy(desc(freelancer_saved_job_posts.created_at));

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
  const [savedJob] = await db
    .delete(freelancer_saved_job_posts)
    .where(
      and(
        eq(freelancer_saved_job_posts.freelancer_id, freelancerId),
        eq(freelancer_saved_job_posts.job_id, jobId),
      ),
    )
    .returning();
  if (!savedJob) throw new ApiError(404, "Saved job post not found.");
  return savedJob;
};

export interface PublicJobFilters {
  query?: string;
  levels?: string[];
  minBudget?: number;
  maxBudget?: number;
  maxProposals?: number;
  paymentVerified?: boolean;
  sort?: "newest" | "budget" | "rating" | "proposals";
}

export interface PublicJobSummary {
  id: string;
  title: string;
  description: string;
  skills: string[];
  totalBudget: number;
  expectedDuration: string;
  expertiseLevel: string;
  publishedAt: Date | null;
  companyName: string;
  clientLocation: string | null;
  paymentVerified: boolean;
  clientRating: number;
  clientTotalSpent: number;
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

  const proposalCountExpr = sql<number>`(
    SELECT count(*) FROM ${proposals} WHERE ${proposals.job_id} = ${job_posts.id}
  )`;

  const conditions = [eq(job_posts.status, "PUBLISHED")];
  if (filters.levels?.length) {
    conditions.push(inArray(job_posts.expertise_level, filters.levels));
  }
  if (filters.minBudget) {
    conditions.push(gte(job_posts.total_budget, String(filters.minBudget)));
  }
  if (filters.maxBudget) {
    conditions.push(lte(job_posts.total_budget, String(filters.maxBudget)));
  }
  if (filters.paymentVerified) {
    conditions.push(eq(accounts.paymentMethodVerified, true));
  }
  if (filters.maxProposals !== undefined) {
    conditions.push(lte(proposalCountExpr, filters.maxProposals));
  }

  const orderBy = (() => {
    switch (filters.sort) {
      case "budget":
        return desc(job_posts.total_budget);
      case "rating":
        return desc(client_spents.rating);
      case "proposals":
        return asc(proposalCountExpr);
      default:
        return desc(job_posts.published_at);
    }
  })();

  const rows = await db
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpent: client_spents.total_spent,
      clientRating: client_spents.rating,
      proposalCount: proposalCountExpr,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const hasMore = rows.length === limit;
  if (!rows.length) return { results: [], hasMore: false };

  const clientCountries = new Map<string, string | null>();
  if (env.clerkSecretKey) {
    const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
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
      totalBudget: Number(row.job.total_budget),
      expectedDuration: row.job.expected_duration,
      expertiseLevel: row.job.expertise_level,
      publishedAt: row.job.published_at,
      companyName: row.companyName,
      clientLocation,
      paymentVerified: row.paymentVerified === true,
      clientRating: Number(row.clientRating ?? 0),
      clientTotalSpent: Number(row.totalSpent ?? 0),
      proposalCount: Number(row.proposalCount),
    });
  }

  return { results, hasMore };
};
