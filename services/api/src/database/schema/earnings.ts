import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";
import { agency_metadata } from "./agency.js";
import { contract_milestones, contracts } from "./contracts.js";

export const freelancer_earning = pgTable(
  "freelancer_earning",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id")
      .notNull()
      .unique()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    total_earning_cents: bigint("total_earning_cents", { mode: "number" })
      .notNull()
      .default(0),
    completed_jobs: integer("completed_jobs").notNull().default(0),
    ongoing_jobs: integer("ongoing_jobs").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
    job_success_score: numeric("job_success_score", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "freelancer_earning_total_earning_cents_check",
      sql`${table.total_earning_cents} >= 0`,
    ),
    check(
      "freelancer_earning_total_earning_cents_max_check",
      sql`${table.total_earning_cents} <= 9007199254740991`,
    ),
    check(
      "freelancer_earning_completed_check",
      sql`${table.completed_jobs} >= 0`,
    ),
    check("freelancer_earning_ongoing_check", sql`${table.ongoing_jobs} >= 0`),
    check("freelancer_earning_reviews_check", sql`${table.review_count} >= 0`),
    check(
      "freelancer_earning_success_check",
      sql`${table.job_success_score} BETWEEN 0 AND 100`,
    ),
    check(
      "freelancer_earning_rating_check",
      sql`${table.rating} BETWEEN 0 AND 5`,
    ),
  ],
);

export const agency_earning = pgTable(
  "agency_earning",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agency_id: uuid("agency_id")
      .notNull()
      .unique()
      .references(() => agency_metadata.id, { onDelete: "cascade" }),
    total_earning_cents: bigint("total_earning_cents", { mode: "number" })
      .notNull()
      .default(0),
    completed_jobs: integer("completed_jobs").notNull().default(0),
    ongoing_jobs: integer("ongoing_jobs").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
    job_success_score: numeric("job_success_score", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "agency_earning_total_earning_cents_check",
      sql`${table.total_earning_cents} >= 0`,
    ),
    check(
      "agency_earning_total_earning_cents_max_check",
      sql`${table.total_earning_cents} <= 9007199254740991`,
    ),
    check("agency_earning_completed_check", sql`${table.completed_jobs} >= 0`),
    check("agency_earning_ongoing_check", sql`${table.ongoing_jobs} >= 0`),
    check("agency_earning_reviews_check", sql`${table.review_count} >= 0`),
    check(
      "agency_earning_success_check",
      sql`${table.job_success_score} BETWEEN 0 AND 100`,
    ),
    check("agency_earning_rating_check", sql`${table.rating} BETWEEN 0 AND 5`),
  ],
);

export const earning_history = pgTable(
  "earning_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id").references(() => accounts.auth_id, {
      onDelete: "cascade",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    milestone_id: uuid("milestone_id")
      .notNull()
      .unique()
      .references(() => contract_milestones.id, { onDelete: "cascade" }),
    amount_cents: bigint("amount_cents", { mode: "number" }).notNull(),
    platform_fee_cents: bigint("platform_fee_cents", { mode: "number" })
      .notNull()
      .default(0),
    description: text("description").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("earning_history_freelancer_created_idx").on(
      table.freelancer_id,
      table.created_at,
    ),
    index("earning_history_agency_created_idx").on(
      table.agency_id,
      table.created_at,
    ),
    check("earning_history_amount_cents_check", sql`${table.amount_cents} > 0`),
    check(
      "earning_history_platform_fee_cents_nonneg_check",
      sql`${table.platform_fee_cents} >= 0`,
    ),
    check(
      "earning_history_platform_fee_cents_lt_amount_check",
      sql`${table.platform_fee_cents} < ${table.amount_cents}`,
    ),
    check(
      "earning_history_amount_cents_max_check",
      sql`${table.amount_cents} <= 9007199254740991`,
    ),
    check(
      "earning_history_platform_fee_cents_max_check",
      sql`${table.platform_fee_cents} <= 9007199254740991`,
    ),
    check(
      "earning_history_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const earningHistoryRelations = relations(
  earning_history,
  ({ one }) => ({
    freelancer: one(accounts, {
      fields: [earning_history.freelancer_id],
      references: [accounts.auth_id],
    }),
    agency: one(agency_metadata, {
      fields: [earning_history.agency_id],
      references: [agency_metadata.id],
    }),
    contract: one(contracts, {
      fields: [earning_history.contract_id],
      references: [contracts.id],
    }),
    milestone: one(contract_milestones, {
      fields: [earning_history.milestone_id],
      references: [contract_milestones.id],
    }),
  }),
);

export const freelancerEarningRelations = relations(
  freelancer_earning,
  ({ one }) => ({
    freelancer: one(accounts, {
      fields: [freelancer_earning.freelancer_id],
      references: [accounts.auth_id],
    }),
  }),
);
