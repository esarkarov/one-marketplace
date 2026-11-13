import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../auth/auth.schema.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { earning_history } from "../contracts/contracts.schema.js";

export const payout_history = pgTable(
  "payout_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id").references(() => accounts.auth_id, {
      onDelete: "cascade",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    earning_history_id: uuid("earning_history_id")
      .notNull()
      .unique()
      .references(() => earning_history.id, { onDelete: "cascade" }),
    amount_cents: bigint("amount_cents", { mode: "number" }).notNull(),
    stripe_transfer_id: text("stripe_transfer_id").unique(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    next_retry_at: timestamp("next_retry_at", { withTimezone: true }),
    paid_at: timestamp("paid_at", { withTimezone: true }),
    notified_at: timestamp("notified_at", { withTimezone: true }),
    idempotency_key: text("idempotency_key"),
    last_error: text("last_error"),
    destination_account_id: text("destination_account_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("payout_history_freelancer_created_idx").on(
      table.freelancer_id,
      table.created_at,
    ),
    index("payout_history_agency_created_idx").on(
      table.agency_id,
      table.created_at,
    ),
    index("payout_history_open_idx")
      .on(
        table.status,
        sql`COALESCE(${table.next_retry_at}, ${table.claimed_at})`,
      )
      .where(sql`${table.status} IN ('PENDING', 'PROCESSING', 'FAILED')`),
    check(
      "payout_history_status_check",
      sql`${table.status} IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED')`,
    ),
    check(
      "payout_history_paid_has_transfer_check",
      sql`(${table.status} = 'PAID') = (${table.stripe_transfer_id} IS NOT NULL)`,
    ),
    check("payout_history_attempts_check", sql`${table.attempts} >= 0`),
    check("payout_history_amount_cents_check", sql`${table.amount_cents} > 0`),
    check(
      "payout_history_amount_cents_max_check",
      sql`${table.amount_cents} <= 9007199254740991`,
    ),
    check(
      "payout_history_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);
