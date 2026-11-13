import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";

export const connects = pgTable(
  "connects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id")
      .unique()
      .references(() => freelancer_metadata.auth_id, {
        onDelete: "cascade",
      }),
    agency_id: uuid("agency_id")
      .unique()
      .references(() => agency_metadata.id, {
        onDelete: "cascade",
      }),
    connects: integer("connects").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "connects_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const connects_history = pgTable("connects_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  connects_id: uuid("connects_id")
    .notNull()
    .references(() => connects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const connects_purchase_history = pgTable(
  "connects_purchase_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connects_id: uuid("connects_id")
      .notNull()
      .references(() => connects.id, { onDelete: "cascade" }),
    purchased_connects: integer("purchased_connects").notNull(),
    amount_paid_cents: bigint("amount_paid_cents", {
      mode: "number",
    }).notNull(),
    payment_id: text("payment_id").notNull().unique(),
    status: text("status").notNull().default("PENDING"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    check(
      "connects_purchase_history_amount_paid_cents_max_check",
      sql`${table.amount_paid_cents} <= 9007199254740991`,
    ),
  ],
);
