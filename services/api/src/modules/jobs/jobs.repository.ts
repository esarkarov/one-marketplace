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
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { client_spents, contracts } from "../contracts/contracts.schema.js";
import { freelancer_saved_job_posts, job_posts } from "./jobs.schema.js";
import { proposals } from "../proposals/proposals.schema.js";

export type NewJobPost = typeof job_posts.$inferInsert;
export type JobData = Omit<NewJobPost, "client_id">;
export type JobUpdate = Partial<NewJobPost>;
export type JobAttachments = NonNullable<NewJobPost["attachments"]>;
type JobMilestone = (typeof job_posts.$inferSelect)["milestones"][number];

export interface PublicJobFilters {
  query?: string;
  levels?: string[];
  minBudgetCents?: number;
  maxBudgetCents?: number;
  maxProposals?: number;
  paymentVerified?: boolean;
  sort?: "newest" | "budget" | "rating" | "proposals";
}

export const insertJobPost = async (
  executor: DbExecutor,
  values: NewJobPost,
) => {
  const [job] = await executor.insert(job_posts).values(values).returning();
  return job;
};

export const findJobPostsWithCounts = (
  executor: DbExecutor,
  userId: string,
  jobId?: string,
) =>
  executor
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

export const findEditableJobPost = async (
  executor: DbExecutor,
  userId: string,
  jobId: string,
) => {
  const [existingJob] = await executor
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
  return existingJob;
};

export const updateJobPostIfEditable = async (
  executor: DbExecutor,
  userId: string,
  jobId: string,
  data: JobUpdate,
  attachments: JobAttachments,
) => {
  const [job] = await executor
    .update(job_posts)
    .set({ ...data, attachments, updated_at: new Date() })
    .where(
      and(
        eq(job_posts.id, jobId),
        eq(job_posts.client_id, userId),
        ne(job_posts.status, "HIRED"),
      ),
    )
    .returning();
  return job;
};

export const deleteJobPostIfEditable = async (
  executor: DbExecutor,
  userId: string,
  jobId: string,
) => {
  const [job] = await executor
    .delete(job_posts)
    .where(
      and(
        eq(job_posts.id, jobId),
        eq(job_posts.client_id, userId),
        ne(job_posts.status, "HIRED"),
      ),
    )
    .returning();
  return job;
};

export const findPublishedJobId = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [job] = await executor
    .select({ id: job_posts.id })
    .from(job_posts)
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);
  return job;
};

export const insertSavedJobIfAbsent = async (
  executor: DbExecutor,
  freelancerId: string,
  jobId: string,
) => {
  const [savedJob] = await executor
    .insert(freelancer_saved_job_posts)
    .values({
      freelancer_id: freelancerId,
      job_id: jobId,
    })
    .onConflictDoNothing()
    .returning();
  return savedJob;
};

export const findSavedJob = async (
  executor: DbExecutor,
  freelancerId: string,
  jobId: string,
) => {
  const [existingSavedJob] = await executor
    .select()
    .from(freelancer_saved_job_posts)
    .where(
      and(
        eq(freelancer_saved_job_posts.freelancer_id, freelancerId),
        eq(freelancer_saved_job_posts.job_id, jobId),
      ),
    )
    .limit(1);
  return existingSavedJob;
};

export const findSavedJobRows = (executor: DbExecutor, freelancerId: string) =>
  executor
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

export const deleteSavedJob = async (
  executor: DbExecutor,
  freelancerId: string,
  jobId: string,
) => {
  const [savedJob] = await executor
    .delete(freelancer_saved_job_posts)
    .where(
      and(
        eq(freelancer_saved_job_posts.freelancer_id, freelancerId),
        eq(freelancer_saved_job_posts.job_id, jobId),
      ),
    )
    .returning();
  return savedJob;
};

export const findPublishedJobFeedRows = (
  executor: DbExecutor,
  filters: PublicJobFilters,
  page: { limit: number; offset: number },
) => {
  const { limit, offset } = page;

  const proposalCountExpr = sql<number>`(
    SELECT count(*) FROM ${proposals} WHERE ${proposals.job_id} = ${job_posts.id}
  )`;

  const conditions = [eq(job_posts.status, "PUBLISHED")];
  if (filters.levels?.length) {
    conditions.push(inArray(job_posts.expertise_level, filters.levels));
  }
  if (filters.minBudgetCents) {
    conditions.push(gte(job_posts.total_budget_cents, filters.minBudgetCents));
  }
  if (filters.maxBudgetCents) {
    conditions.push(lte(job_posts.total_budget_cents, filters.maxBudgetCents));
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
        return desc(job_posts.total_budget_cents);
      case "rating":
        return desc(client_spents.rating);
      case "proposals":
        return asc(proposalCountExpr);
      default:
        return desc(job_posts.published_at);
    }
  })();

  return executor
    .select({
      job: job_posts,
      companyName: client_metadata.company_name,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
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
};

export const appendJobMilestone = async (
  executor: DbExecutor,
  jobId: string,
  milestone: JobMilestone,
  now: Date,
) => {
  const [currentJob] = await executor
    .select({ milestones: job_posts.milestones })
    .from(job_posts)
    .where(eq(job_posts.id, jobId));
  await executor
    .update(job_posts)
    .set({
      milestones: [...(currentJob?.milestones ?? []), milestone],
      total_budget_cents: sql`${job_posts.total_budget_cents} + ${milestone.budgetCents}`,
      updated_at: now,
    })
    .where(eq(job_posts.id, jobId));
};
