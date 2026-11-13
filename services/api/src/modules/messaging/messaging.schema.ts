import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
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

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job_id: uuid("job_id").references(() => job_posts.id, {
      onDelete: "set null",
    }),
    proposal_id: uuid("proposal_id").references(() => proposals.id, {
      onDelete: "set null",
    }),
    context_key: text("context_key").notNull(),
    last_message_id: uuid("last_message_id").references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),
    last_message_at: timestamp("last_message_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("conversations_context_key_unique").on(table.context_key),
    index("conversations_last_message_at_idx").on(table.last_message_at),
    index("conversations_job_id_idx").on(table.job_id),
    index("conversations_proposal_id_idx").on(table.proposal_id),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversation_id: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sender_id: text("sender_id").references(() => accounts.auth_id, {
      onDelete: "set null",
    }),
    message_type: text("message_type").notNull().default("USER"),
    body: text("body"),
    event_type: text("event_type"),
    event_payload: jsonb("event_payload").$type<Record<string, unknown>>(),
    reply_to_message_id: uuid("reply_to_message_id").references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("messages_conversation_created_id_idx").on(
      table.conversation_id,
      table.created_at,
      table.id,
    ),
    index("messages_reply_to_message_id_idx").on(table.reply_to_message_id),
    check(
      "messages_content_check",
      sql`${table.message_type} = 'USER' OR (${table.message_type} = 'SYSTEM_EVENT' AND ${table.event_type} IS NOT NULL)`,
    ),
  ],
);

export const conversation_participants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversation_id: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    account_id: text("account_id").references(() => accounts.auth_id, {
      onDelete: "cascade",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    participant_type: text("participant_type").notNull(),
    last_read_message_id: uuid("last_read_message_id").references(
      () => messages.id,
      { onDelete: "set null" },
    ),
    last_read_at: timestamp("last_read_at", { withTimezone: true }),
    unread_count: integer("unread_count").notNull().default(0),
    joined_at: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_active_at: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("conversation_participants_conversation_account_unique").on(
      table.conversation_id,
      table.account_id,
    ),
    uniqueIndex("conversation_participants_conversation_agency_unique").on(
      table.conversation_id,
      table.agency_id,
    ),
    index("conversation_participants_account_conversation_idx").on(
      table.account_id,
      table.conversation_id,
    ),
    index("conversation_participants_agency_conversation_idx").on(
      table.agency_id,
      table.conversation_id,
    ),
    check(
      "conversation_participants_unread_count_check",
      sql`${table.unread_count} >= 0`,
    ),
    check(
      "conversation_participants_owner_check",
      sql`(${table.account_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const message_attachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    message_id: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    storage_key: text("storage_key").notNull(),
    file_url: text("file_url").notNull(),
    file_name: text("file_name").notNull(),
    mime_type: text("mime_type").notNull(),
    file_size: integer("file_size").notNull(),
    attachment_type: text("attachment_type").notNull(),
    is_available: boolean("is_available").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("message_attachments_message_created_idx").on(
      table.message_id,
      table.created_at,
    ),
    check("message_attachments_file_size_check", sql`${table.file_size} >= 0`),
  ],
);
