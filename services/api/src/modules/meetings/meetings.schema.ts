import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../auth/auth.schema.js";
import { conversations, messages } from "../messaging/messaging.schema.js";

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversation_id: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    message_id: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("daily"),
    provider_room_name: text("provider_room_name").notNull(),
    join_url: text("join_url").notNull(),
    started_by_account_id: text("started_by_account_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ACTIVE"),
    started_at: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("meetings_provider_room_name_unique").on(
      table.provider_room_name,
    ),
    index("meetings_conversation_status_idx").on(
      table.conversation_id,
      table.status,
    ),
    uniqueIndex("meetings_one_active_per_conversation_unique")
      .on(table.conversation_id)
      .where(sql`${table.status} = 'ACTIVE'`),
    check("meetings_status_check", sql`${table.status} IN ('ACTIVE', 'ENDED')`),
  ],
);
