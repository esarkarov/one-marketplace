import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { job_posts } from "../jobs/jobs.schema.js";

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "cascade" }),
    sender_id: text("sender_id").notNull(),
    sender_type: text("sender_type").notNull(),
    cover_letter: text("cover_letter").notNull(),
    bid_amount_cents: bigint("bid_amount_cents", { mode: "number" }).notNull(),
    duration: text("duration").notNull(),
    screening_answers: jsonb("screening_answers")
      .$type<Array<{ question: string; answer: string }>>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("SUBMITTED"),
    is_shortlisted: boolean("is_shortlisted").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("proposal_sender_job_unique").on(table.sender_id, table.job_id),
    check(
      "proposals_bid_amount_cents_max_check",
      sql`${table.bid_amount_cents} <= 9007199254740991`,
    ),
  ],
);

export const proposalRelations = relations(proposals, ({ one }) => ({
  job: one(job_posts, {
    fields: [proposals.job_id],
    references: [job_posts.id],
  }),
}));
