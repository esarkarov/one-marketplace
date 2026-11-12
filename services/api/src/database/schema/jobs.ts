import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";
import { freelancer_metadata } from "./freelancer.js";

export const job_posts = pgTable(
  "job_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    client_id: text("client_id")
      .notNull()
      .references(() => accounts.auth_id, {
        onDelete: "cascade",
      }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    expertise_level: text("expertise_level").notNull(),
    expected_duration: text("expected_duration").notNull(),
    skills: text("skills").array().notNull().default([]),

    total_budget_cents: bigint("total_budget_cents", {
      mode: "number",
    }).notNull(),

    milestones: jsonb("milestones")
      .$type<
        Array<{
          id: string;
          title: string;
          budgetCents: number;
          dueDate: string;
        }>
      >()
      .notNull(),

    screening_questions: text("screening_questions").array().default([]),

    attachments: jsonb("attachments")
      .$type<
        Array<{
          fileId: string;
          fileName: string;
          fileUrl: string;
          fileType: string;
          fileSize: number;
        }>
      >()
      .default([]),

    status: text("status").notNull().default("DRAFT"),

    published_at: timestamp("published_at", {
      withTimezone: true,
    }),

    hired_at: timestamp("hired_at", {
      withTimezone: true,
    }),

    created_at: timestamp("created_at", {
      withTimezone: true,
    }).defaultNow(),

    updated_at: timestamp("updated_at", {
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    check(
      "job_posts_total_budget_cents_max_check",
      sql`${table.total_budget_cents} <= 9007199254740991`,
    ),
  ],
);

export const freelancer_saved_job_posts = pgTable(
  "freelancer_saved_job_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "cascade" }),
    freelancer_id: text("freelancer_id")
      .notNull()
      .references(() => freelancer_metadata.auth_id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("freelancer_saved_job_posts_freelancer_job_unique").on(
      table.freelancer_id,
      table.job_id,
    ),
  ],
);

export const freelancerSavedJobPostRelations = relations(
  freelancer_saved_job_posts,
  ({ one }) => ({
    job: one(job_posts, {
      fields: [freelancer_saved_job_posts.job_id],
      references: [job_posts.id],
    }),
    freelancer: one(freelancer_metadata, {
      fields: [freelancer_saved_job_posts.freelancer_id],
      references: [freelancer_metadata.auth_id],
    }),
  }),
);
