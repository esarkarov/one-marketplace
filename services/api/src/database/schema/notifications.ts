import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agency_metadata } from "./agency.js";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event_id: text("event_id").notNull().unique(),
    recipient_id: text("recipient_id"),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    is_read: boolean("is_read").notNull().default(false),
    read_at: timestamp("read_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "notifications_target_check",
      sql`(${table.recipient_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);
