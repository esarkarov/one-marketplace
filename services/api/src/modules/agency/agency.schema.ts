import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../auth/auth.schema.js";

export const agency_metadata = pgTable("agency_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  owner_id: text("owner_id")
    .notNull()
    .unique()
    .references(() => accounts.auth_id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  professional_title: text("professional_title"),
  size: text("size").notNull(),
  specialty: text("specialty").notNull(),
  website: text("website"),
  overview: text("overview").notNull(),
  tags: text("tags").array().notNull().default([]),
  avatar_image: jsonb("avatar_image").$type<{
    imageId: string;
    url: string;
  }>(),
  is_onboarded: boolean("is_onboarded").notNull().default(false),
  stripe_connect_account_id: text("stripe_connect_account_id"),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agency_portfolios = pgTable("agency_portfolios", {
  id: uuid("id").defaultRandom().primaryKey(),
  agency_id: uuid("agency_id")
    .notNull()
    .references(() => agency_metadata.id, {
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

export const agency_members = pgTable("agency_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  agency_id: uuid("agency_id")
    .notNull()
    .references(() => agency_metadata.id, { onDelete: "cascade" }),
  freelancer_id: text("freelancer_id")
    .notNull()
    .unique()
    .references(() => accounts.auth_id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const agency_invitations = pgTable(
  "agency_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agency_id: uuid("agency_id")
      .notNull()
      .references(() => agency_metadata.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("Agency member"),
    status: text("status").notNull().default("PENDING"),
    invited_by: text("invited_by")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    responded_at: timestamp("responded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agency_invitations_email_status_idx").on(table.email, table.status),
    index("agency_invitations_agency_status_idx").on(
      table.agency_id,
      table.status,
    ),
  ],
);

export const agencyMetadataRelations = relations(
  agency_metadata,
  ({ one, many }) => ({
    owner: one(accounts, {
      fields: [agency_metadata.owner_id],
      references: [accounts.auth_id],
    }),
    portfolios: many(agency_portfolios),
    members: many(agency_members),
  }),
);

export const agencyPortfolioRelations = relations(
  agency_portfolios,
  ({ one }) => ({
    agency: one(agency_metadata, {
      fields: [agency_portfolios.agency_id],
      references: [agency_metadata.id],
    }),
  }),
);

export const agencyMemberRelations = relations(agency_members, ({ one }) => ({
  agency: one(agency_metadata, {
    fields: [agency_members.agency_id],
    references: [agency_metadata.id],
  }),
  freelancer: one(accounts, {
    fields: [agency_members.freelancer_id],
    references: [accounts.auth_id],
  }),
}));
