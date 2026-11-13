import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const freelancer_metadata = pgTable(
  "freelancer_metadata",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auth_id: text("auth_id").notNull().unique(),
    professional_title: text("professional_title").notNull(),
    professional_description: text("professional_description").notNull(),
    hourly_rate_cents: bigint("hourly_rate_cents", {
      mode: "number",
    }).notNull(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    availability_status: text("availability_status")
      .notNull()
      .default("AVAILABLE"),
    weekly_availability: text("weekly_availability").notNull(),
    experience_level: text("experience_level").notNull(),
    skills: text("skills").array().notNull().default([]),
    languages: jsonb("languages")
      .$type<Array<{ language: string; proficiency: string }>>()
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "freelancer_metadata_hourly_rate_cents_max_check",
      sql`${table.hourly_rate_cents} <= 9007199254740991`,
    ),
  ],
);

export const freelancer_portfolios = pgTable("freelancer_portfolios", {
  id: uuid("id").defaultRandom().primaryKey(),
  freelancer_id: uuid("freelancer_id")
    .notNull()
    .references(() => freelancer_metadata.id, {
      onDelete: "cascade",
    }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  live_url: text("live_url"),
  cover_image: jsonb("cover_image")
    .$type<{
      imageId: string;
      url: string;
    }>()
    .notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
