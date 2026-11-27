import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const outbox_events = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event_id: uuid("event_id").notNull().unique(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    traceparent: text("traceparent"),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    next_attempt_at: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    published_at: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "outbox_events_status_check",
      sql`${table.status} IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'DEAD')`,
    ),
    index("outbox_events_due_idx")
      .on(table.next_attempt_at)
      .where(sql`${table.status} IN ('PENDING', 'PUBLISHING')`),
    index("outbox_events_status_published_idx").on(
      table.status,
      table.published_at,
    ),
  ],
);
