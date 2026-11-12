import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../auth/auth.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { job_posts } from "../jobs/jobs.schema.js";
import { proposals } from "../proposals/proposals.schema.js";

export const contractStatus = pgEnum("contract_status", [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
]);

export const contractMilestoneStatus = pgEnum("contract_milestone_status", [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
]);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposal_id: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "restrict" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "restrict" }),
    client_id: text("client_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "restrict" }),
    freelancer_id: text("freelancer_id").references(() => accounts.auth_id, {
      onDelete: "restrict",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    total_amount_cents: bigint("total_amount_cents", {
      mode: "number",
    }).notNull(),
    status: contractStatus().notNull().default("PENDING"),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contracts_proposal_id_unique").on(table.proposal_id),
    index("contracts_client_status_idx").on(table.client_id, table.status),
    index("contracts_freelancer_status_idx").on(
      table.freelancer_id,
      table.status,
    ),
    check(
      "contracts_total_amount_cents_check",
      sql`${table.total_amount_cents} > 0`,
    ),
    check(
      "contracts_total_amount_cents_max_check",
      sql`${table.total_amount_cents} <= 9007199254740991`,
    ),
    check(
      "contracts_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const contract_milestones = pgTable(
  "contract_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amount_cents: bigint("amount_cents", { mode: "number" }).notNull(),
    due_date: date("due_date").notNull(),
    position: integer("position").notNull(),
    status: contractMilestoneStatus().notNull().default("PENDING"),
    stripe_checkout_session_id: text("stripe_checkout_session_id").unique(),
    stripe_payment_intent_id: text("stripe_payment_intent_id").unique(),
    funded_at: timestamp("funded_at", { withTimezone: true }),
    payment_requested_at: timestamp("payment_requested_at", {
      withTimezone: true,
    }),
    submission_message: text("submission_message"),
    submission_delivery_link: text("submission_delivery_link"),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contract_milestones_contract_position_unique").on(
      table.contract_id,
      table.position,
    ),
    index("contract_milestones_contract_status_idx").on(
      table.contract_id,
      table.status,
    ),
    check(
      "contract_milestones_amount_cents_check",
      sql`${table.amount_cents} > 0`,
    ),
    check(
      "contract_milestones_amount_cents_max_check",
      sql`${table.amount_cents} <= 9007199254740991`,
    ),
    check("contract_milestones_position_check", sql`${table.position} >= 0`),
  ],
);

export const contractRelations = relations(contracts, ({ many, one }) => ({
  proposal: one(proposals, {
    fields: [contracts.proposal_id],
    references: [proposals.id],
  }),
  job: one(job_posts, {
    fields: [contracts.job_id],
    references: [job_posts.id],
  }),
  client: one(accounts, {
    fields: [contracts.client_id],
    references: [accounts.auth_id],
    relationName: "contract_client",
  }),
  freelancer: one(accounts, {
    fields: [contracts.freelancer_id],
    references: [accounts.auth_id],
    relationName: "contract_freelancer",
  }),
  milestones: many(contract_milestones),
}));

export const contractMilestoneRelations = relations(
  contract_milestones,
  ({ one }) => ({
    contract: one(contracts, {
      fields: [contract_milestones.contract_id],
      references: [contracts.id],
    }),
  }),
);

export const client_spents = pgTable(
  "client_spents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    client_id: text("client_id")
      .notNull()
      .unique()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    total_spent_cents: bigint("total_spent_cents", { mode: "number" })
      .notNull()
      .default(0),
    completed_contracts: integer("completed_contracts").notNull().default(0),
    ongoing_contracts: integer("ongoing_contracts").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
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
      "client_spents_total_spent_cents_check",
      sql`${table.total_spent_cents} >= 0`,
    ),
    check(
      "client_spents_total_spent_cents_max_check",
      sql`${table.total_spent_cents} <= 9007199254740991`,
    ),
    check(
      "client_spents_completed_check",
      sql`${table.completed_contracts} >= 0`,
    ),
    check("client_spents_ongoing_check", sql`${table.ongoing_contracts} >= 0`),
    check("client_spents_reviews_check", sql`${table.review_count} >= 0`),
    check("client_spents_rating_check", sql`${table.rating} BETWEEN 0 AND 5`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    reviewer_id: text("reviewer_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    reviewee_id: text("reviewee_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("reviews_contract_reviewer_unique").on(
      table.contract_id,
      table.reviewer_id,
    ),
    index("reviews_reviewee_created_idx").on(
      table.reviewee_id,
      table.created_at,
    ),
    index("reviews_agency_created_idx").on(table.agency_id, table.created_at),
    check("reviews_rating_check", sql`${table.rating} BETWEEN 1 AND 5`),
    check(
      "reviews_different_accounts_check",
      sql`${table.reviewer_id} <> ${table.reviewee_id}`,
    ),
  ],
);

export const clientSpentsRelations = relations(client_spents, ({ one }) => ({
  client: one(accounts, {
    fields: [client_spents.client_id],
    references: [accounts.auth_id],
  }),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
  contract: one(contracts, {
    fields: [reviews.contract_id],
    references: [contracts.id],
  }),
  reviewer: one(accounts, {
    fields: [reviews.reviewer_id],
    references: [accounts.auth_id],
    relationName: "review_reviewer",
  }),
  reviewee: one(accounts, {
    fields: [reviews.reviewee_id],
    references: [accounts.auth_id],
    relationName: "review_reviewee",
  }),
}));

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
