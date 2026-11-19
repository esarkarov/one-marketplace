import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { fetchSize } from "@/shared/validation/utils/pagination.utils.js";
import { accounts } from "@/modules/auth/models/auth.model.js";
import { client_metadata } from "@/modules/client/models/client.model.js";
import {
  client_spents,
  contracts,
} from "@/modules/contracts/models/contracts.model.js";
import { job_posts } from "@/modules/jobs/models/jobs.model.js";
import { jobPostColumns } from "@/modules/jobs/index.js";
import { proposals } from "@/modules/proposals/models/proposals.model.js";

export interface JobFeedSqlFilters {
  levels?: string[];
  durations?: string[];
  minBudgetCents?: number;
  maxBudgetCents?: number;
  minProposals?: number;
  maxProposals?: number;
  paymentVerified?: boolean;
}

const proposalTotalSql = sql`(select count(*) from ${proposals} where ${proposals.job_id} = ${job_posts.id})`;

const feedConditions = (filters: JobFeedSqlFilters) => {
  const conditions: SQL[] = [eq(job_posts.status, "PUBLISHED")];
  if (filters.levels?.length) {
    conditions.push(inArray(job_posts.expertise_level, filters.levels));
  }
  if (filters.durations?.length) {
    conditions.push(inArray(job_posts.expected_duration, filters.durations));
  }
  if (filters.minBudgetCents !== undefined) {
    conditions.push(gte(job_posts.total_budget_cents, filters.minBudgetCents));
  }
  if (filters.maxBudgetCents !== undefined) {
    conditions.push(lte(job_posts.total_budget_cents, filters.maxBudgetCents));
  }
  if (filters.paymentVerified) {
    conditions.push(sql`${accounts.paymentMethodVerified} is true`);
  }
  if (filters.minProposals !== undefined) {
    conditions.push(
      sql`${proposalTotalSql} >= ${filters.minProposals}::bigint`,
    );
  }
  if (filters.maxProposals !== undefined) {
    conditions.push(
      sql`${proposalTotalSql} <= ${filters.maxProposals}::bigint`,
    );
  }
  return and(...conditions);
};

export const listRecentJobIds = async (
  executor: DbExecutor,
  filters: JobFeedSqlFilters,
  { limit, offset }: { limit: number; offset: number },
) => {
  const rows = await executor
    .select({ id: job_posts.id })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .where(feedConditions(filters))
    .orderBy(desc(job_posts.published_at), desc(job_posts.id))
    .limit(fetchSize(limit))
    .offset(offset);
  return rows.map((row) => row.id);
};

const normalizeSql = (value: SQL) =>
  sql`regexp_replace(lower(${value}), '[^a-z0-9]', '', 'g')`;

const textArraySql = (values: string[]) =>
  sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}::text`),
    sql`, `,
  )}]::text[]`;

export interface BestMatchJobId {
  id: string;
  score: number;
}

/*
 * `skills` are the caller skills already normalized by the service (lowercase,
 * only a-z0-9), not deduplicated and with empty strings kept: a duplicate counts
 * each time and an empty skill matches every job, as the JS pipeline did. The
 * job side is normalized here with the same expression. NULL elements in a job
 * skills array are skipped; the API cannot produce them.
 */
export const listBestMatchJobIds = async (
  executor: DbExecutor,
  filters: JobFeedSqlFilters,
  skills: string[],
  { limit, offset }: { limit: number; offset: number },
): Promise<BestMatchJobId[]> => {
  if (skills.length === 0) return [];
  const callerSkills = textArraySql(skills);
  const result = await executor.execute<{ id: string; score: number }>(sql`
    select feed.id, feed.score
    from (
      select
        ${job_posts.id} as id,
        ${job_posts.published_at} as published_at,
        ${job_posts.created_at} as created_at,
        (
          2 * (
            select count(*) from unnest(${callerSkills}) as caller(skill)
            where exists (
              select 1 from unnest(job_text.skills_norm) as job_skill(name)
              where strpos(job_skill.name, caller.skill) > 0
            )
          )
          + (
            select count(*) from unnest(${callerSkills}) as caller(skill)
            where strpos(${job_posts.content_norm}, caller.skill) > 0
          )
        )::int as score
      from ${job_posts}
      inner join ${accounts} on ${job_posts.client_id} = ${accounts.auth_id}
      inner join ${client_metadata}
        on ${job_posts.client_id} = ${client_metadata.auth_id}
      cross join lateral (
        select
          coalesce((
            select array_agg(${normalizeSql(sql`raw_skill.name`)})
            from unnest(${job_posts.skills}) as raw_skill(name)
            where raw_skill.name is not null
          ), '{}'::text[]) as skills_norm
        offset 0
      ) as job_text
      where ${feedConditions(filters)}
      offset 0
    ) as feed
    where feed.score > 0
    order by
      feed.score desc,
      date_trunc('milliseconds', coalesce(feed.published_at, feed.created_at, 'epoch'::timestamptz)) desc,
      feed.id desc
    limit ${fetchSize(limit)} offset ${offset}
  `);
  return result.rows.map((row) => ({ id: row.id, score: Number(row.score) }));
};

export const listFeedJobsByIds = async (
  executor: DbExecutor,
  jobIds: string[],
) => {
  if (jobIds.length === 0) return [];
  return executor
    .select({
      job: jobPostColumns,
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      clientCountry: client_metadata.country,
      paymentVerified: accounts.paymentMethodVerified,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
      proposalCount: sql<number>`${proposalTotalSql}::int`,
      hireCount: sql<number>`(select count(*) from ${contracts} where ${contracts.job_id} = ${job_posts.id} and ${contracts.status} in ('ACTIVE', 'COMPLETED'))::int`,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(inArray(job_posts.id, jobIds))
    .orderBy(desc(job_posts.published_at), desc(job_posts.id));
};

export const findPublishedJobDetail = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [result] = await executor
    .select({
      job: jobPostColumns,
      clientAccountId: accounts.id,
      companyName: client_metadata.company_name,
      companyDescription: client_metadata.company_description,
      clientCountry: client_metadata.country,
      paymentVerified: accounts.paymentMethodVerified,
      clientJoinedAt: accounts.created_at,
      totalSpentCents: client_spents.total_spent_cents,
      clientRating: client_spents.rating,
      clientReviewCount: client_spents.review_count,
    })
    .from(job_posts)
    .innerJoin(accounts, eq(job_posts.client_id, accounts.auth_id))
    .innerJoin(
      client_metadata,
      eq(job_posts.client_id, client_metadata.auth_id),
    )
    .leftJoin(client_spents, eq(job_posts.client_id, client_spents.client_id))
    .where(and(eq(job_posts.id, jobId), eq(job_posts.status, "PUBLISHED")))
    .limit(1);
  return result;
};

export const countProposalsForJob = async (
  executor: DbExecutor,
  jobId: string,
) => {
  const [proposalTotal] = await executor
    .select({ count: count(proposals.id) })
    .from(proposals)
    .where(eq(proposals.job_id, jobId));
  return proposalTotal;
};

export const countHiresForJob = async (executor: DbExecutor, jobId: string) => {
  const [hireTotal] = await executor
    .select({ count: count(contracts.id) })
    .from(contracts)
    .where(
      and(
        eq(contracts.job_id, jobId),
        inArray(contracts.status, ["ACTIVE", "COMPLETED"]),
      ),
    );
  return hireTotal;
};
