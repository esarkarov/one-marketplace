import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const accountRole = pgEnum("account_role", ["FREELANCER", "CLIENT"]);

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
