import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accountRole } from "./enums.js";

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  auth_id: text("auth_id").notNull().unique(),
  email: text("email").notNull(),
  stripe_customer_id: text("stripe_customer_id").unique(),
  stripe_connect_account_id: text("stripe_connect_account_id").unique(),
  role: accountRole().default("CLIENT").notNull(),
  identityVerified: boolean("identityVerified").default(false),
  paymentMethodVerified: boolean("paymentMethodVerified").default(false),
  isOnboardingComplete: boolean("isOnboardingComplete").default(false),
  created_at: timestamp("created_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
});

export const client_metadata = pgTable("client_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  auth_id: text("auth_id").notNull().unique(),
  role: text("role").notNull(),
  company_name: text("company_name").notNull(),
  company_website: text("company_website").notNull(),
  company_size: text("company_size").notNull(),
  industry: text("industry").notNull(),
  company_description: text("company_description").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
});
