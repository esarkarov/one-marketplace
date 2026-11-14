import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import { freelancer_earning } from "../contracts/contracts.schema.js";
import { freelancer_metadata } from "./freelancer.schema.js";

export interface TalentSearchCriteria {
  verifiedOnly?: boolean;
  availableOnly?: boolean;
  minRating?: number;
  minSuccess?: number;
  minRateCents?: number;
  maxRateCents?: number;
  sort?: "recommended" | "rating" | "success" | "projects" | "rate-low";
}

export const searchFreelancerRows = (
  executor: DbExecutor,
  criteria: TalentSearchCriteria,
  page: { limit: number; offset: number },
) => {
  const conditions = [];
  if (criteria.verifiedOnly)
    conditions.push(eq(accounts.identityVerified, true));
  if (criteria.availableOnly) {
    conditions.push(eq(freelancer_metadata.availability_status, "AVAILABLE"));
  }
  if (criteria.minRating) {
    conditions.push(gte(freelancer_earning.rating, String(criteria.minRating)));
  }
  if (criteria.minSuccess) {
    conditions.push(
      gte(freelancer_earning.job_success_score, String(criteria.minSuccess)),
    );
  }
  if (criteria.minRateCents) {
    conditions.push(
      gte(freelancer_metadata.hourly_rate_cents, criteria.minRateCents),
    );
  }
  if (criteria.maxRateCents) {
    conditions.push(
      lte(freelancer_metadata.hourly_rate_cents, criteria.maxRateCents),
    );
  }

  const orderBy = (() => {
    switch (criteria.sort) {
      case "rating":
        return desc(freelancer_earning.rating);
      case "success":
        return desc(freelancer_earning.job_success_score);
      case "projects":
        return desc(freelancer_earning.completed_jobs);
      case "rate-low":
        return asc(freelancer_metadata.hourly_rate_cents);
      default:
        return desc(
          sql`${freelancer_earning.rating} * ${freelancer_earning.job_success_score}`,
        );
    }
  })();

  return executor
    .select({
      id: freelancer_metadata.id,
      authId: freelancer_metadata.auth_id,
      professionalTitle: freelancer_metadata.professional_title,
      professionalDescription: freelancer_metadata.professional_description,
      hourlyRateCents: freelancer_metadata.hourly_rate_cents,
      city: freelancer_metadata.city,
      country: freelancer_metadata.country,
      skills: freelancer_metadata.skills,
      availabilityStatus: freelancer_metadata.availability_status,
      identityVerified: accounts.identityVerified,
      rating: freelancer_earning.rating,
      jobSuccessScore: freelancer_earning.job_success_score,
      completedJobs: freelancer_earning.completed_jobs,
      reviewCount: freelancer_earning.review_count,
    })
    .from(freelancer_metadata)
    .innerJoin(accounts, eq(accounts.auth_id, freelancer_metadata.auth_id))
    .leftJoin(
      freelancer_earning,
      eq(freelancer_earning.freelancer_id, freelancer_metadata.auth_id),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderBy)
    .limit(page.limit)
    .offset(page.offset);
};
