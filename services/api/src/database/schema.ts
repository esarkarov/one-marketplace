import { relations, sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountRole = pgEnum("account_role", ["FREELANCER", "CLIENT"]);
export const contractStatus = pgEnum("contract_status", [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
]);
export const contractMilestoneStatus = pgEnum("contract_milestone_status", [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
]);

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

export const freelancer_metadata = pgTable("freelancer_metadata", {
  id: uuid("id").defaultRandom().primaryKey(),
  auth_id: text("auth_id").notNull().unique(),
  professional_title: text("professional_title").notNull(),
  professional_description: text("professional_description").notNull(),
  hourly_rate: numeric("hourly_rate", {
    precision: 6,
    scale: 2,
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
});

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

export const freelancerMetadataRelations = relations(
  freelancer_metadata,
  ({ many }) => ({
    portfolios: many(freelancer_portfolios),
  }),
);

export const freelancerPortfolioRelations = relations(
  freelancer_portfolios,
  ({ one }) => ({
    freelancer: one(freelancer_metadata, {
      fields: [freelancer_portfolios.freelancer_id],
      references: [freelancer_metadata.id],
    }),
  }),
);

export const job_posts = pgTable("job_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  client_id: text("client_id")
    .notNull()
    .references(() => accounts.auth_id, {
      onDelete: "cascade",
    }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  expertise_level: text("expertise_level").notNull(),
  expected_duration: text("expected_duration").notNull(),
  skills: text("skills").array().notNull().default([]),

  total_budget: numeric("total_budget", {
    precision: 9,
    scale: 2,
  }).notNull(),

  milestones: jsonb("milestones")
    .$type<
      Array<{
        id: string;
        title: string;
        budget: number;
        dueDate: string;
      }>
    >()
    .notNull(),

  screening_questions: text("screening_questions").array().default([]),

  attachments: jsonb("attachments")
    .$type<
      Array<{
        fileId: string;
        fileName: string;
        fileUrl: string;
        fileType: string;
        fileSize: number;
      }>
    >()
    .default([]),

  status: text("status").notNull().default("DRAFT"),

  published_at: timestamp("published_at", {
    withTimezone: true,
  }),

  hired_at: timestamp("hired_at", {
    withTimezone: true,
  }),

  created_at: timestamp("created_at", {
    withTimezone: true,
  }).defaultNow(),

  updated_at: timestamp("updated_at", {
    withTimezone: true,
  }).defaultNow(),
});

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

export const connects_purchase_history = pgTable("connects_purchase_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  connects_id: uuid("connects_id")
    .notNull()
    .references(() => connects.id, { onDelete: "cascade" }),
  purchased_connects: integer("purchased_connects").notNull(),
  amount_paid: numeric("amount_paid").notNull(),
  payment_id: text("payment_id").notNull().unique(),
  status: text("status").notNull().default("PENDING"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const connectsRelations = relations(connects, ({ many, one }) => ({
  freelancer: one(freelancer_metadata, {
    fields: [connects.freelancer_id],
    references: [freelancer_metadata.auth_id],
  }),
  agency: one(agency_metadata, {
    fields: [connects.agency_id],
    references: [agency_metadata.id],
  }),
  history: many(connects_history),
  purchases: many(connects_purchase_history),
}));

export const connectsHistoryRelations = relations(
  connects_history,
  ({ one }) => ({
    balance: one(connects, {
      fields: [connects_history.connects_id],
      references: [connects.id],
    }),
  }),
);

export const connectsPurchaseHistoryRelations = relations(
  connects_purchase_history,
  ({ one }) => ({
    balance: one(connects, {
      fields: [connects_purchase_history.connects_id],
      references: [connects.id],
    }),
  }),
);

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

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "cascade" }),
    sender_id: text("sender_id").notNull(),
    sender_type: text("sender_type").notNull(),
    cover_letter: text("cover_letter").notNull(),
    bid_amount: numeric("bid_amount", { precision: 9, scale: 2 }).notNull(),
    duration: text("duration").notNull(),
    screening_answers: jsonb("screening_answers")
      .$type<Array<{ question: string; answer: string }>>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("SUBMITTED"),
    is_shortlisted: boolean("is_shortlisted").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("proposal_sender_job_unique").on(table.sender_id, table.job_id),
  ],
);

export const proposalRelations = relations(proposals, ({ one }) => ({
  job: one(job_posts, {
    fields: [proposals.job_id],
    references: [job_posts.id],
  }),
}));

export const freelancer_saved_job_posts = pgTable(
  "freelancer_saved_job_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "cascade" }),
    freelancer_id: text("freelancer_id")
      .notNull()
      .references(() => freelancer_metadata.auth_id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("freelancer_saved_job_posts_freelancer_job_unique").on(
      table.freelancer_id,
      table.job_id,
    ),
  ],
);

export const freelancerSavedJobPostRelations = relations(
  freelancer_saved_job_posts,
  ({ one }) => ({
    job: one(job_posts, {
      fields: [freelancer_saved_job_posts.job_id],
      references: [job_posts.id],
    }),
    freelancer: one(freelancer_metadata, {
      fields: [freelancer_saved_job_posts.freelancer_id],
      references: [freelancer_metadata.auth_id],
    }),
  }),
);

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
    check("meetings_status_check", sql`${table.status} IN ('ACTIVE', 'ENDED')`),
  ],
);

export const conversationRelations = relations(
  conversations,
  ({ many, one }) => ({
    job: one(job_posts, {
      fields: [conversations.job_id],
      references: [job_posts.id],
    }),
    proposal: one(proposals, {
      fields: [conversations.proposal_id],
      references: [proposals.id],
    }),
    lastMessage: one(messages, {
      fields: [conversations.last_message_id],
      references: [messages.id],
    }),
    participants: many(conversation_participants),
    messages: many(messages),
  }),
);

export const conversationParticipantRelations = relations(
  conversation_participants,
  ({ one }) => ({
    conversations: one(conversations, {
      fields: [conversation_participants.conversation_id],
      references: [conversations.id],
    }),
    account: one(accounts, {
      fields: [conversation_participants.account_id],
      references: [accounts.auth_id],
    }),
    lastReadMessage: one(messages, {
      fields: [conversation_participants.last_read_message_id],
      references: [messages.id],
    }),
  }),
);

export const messageRelations = relations(messages, ({ many, one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversation_id],
    references: [conversations.id],
  }),
  sender: one(accounts, {
    fields: [messages.sender_id],
    references: [accounts.auth_id],
  }),
  replyTo: one(messages, {
    fields: [messages.reply_to_message_id],
    references: [messages.id],
    relationName: "message_replies",
  }),
  replies: many(messages, { relationName: "message_replies" }),
  attachments: many(message_attachments),
}));

export const messageAttachmentRelations = relations(
  message_attachments,
  ({ one }) => ({
    message: one(messages, {
      fields: [message_attachments.message_id],
      references: [messages.id],
    }),
  }),
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposal_id: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "restrict" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => job_posts.id, { onDelete: "restrict" }),
    client_id: text("client_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "restrict" }),
    freelancer_id: text("freelancer_id").references(() => accounts.auth_id, {
      onDelete: "restrict",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    total_amount: numeric("total_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    status: contractStatus().notNull().default("PENDING"),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contracts_proposal_id_unique").on(table.proposal_id),
    index("contracts_client_status_idx").on(table.client_id, table.status),
    index("contracts_freelancer_status_idx").on(
      table.freelancer_id,
      table.status,
    ),
    check("contracts_total_amount_check", sql`${table.total_amount} > 0`),
    check(
      "contracts_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const contract_milestones = pgTable(
  "contract_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    due_date: date("due_date").notNull(),
    position: integer("position").notNull(),
    status: contractMilestoneStatus().notNull().default("PENDING"),
    stripe_checkout_session_id: text("stripe_checkout_session_id").unique(),
    stripe_payment_intent_id: text("stripe_payment_intent_id").unique(),
    funded_at: timestamp("funded_at", { withTimezone: true }),
    payment_requested_at: timestamp("payment_requested_at", {
      withTimezone: true,
    }),
    submission_message: text("submission_message"),
    submission_delivery_link: text("submission_delivery_link"),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contract_milestones_contract_position_unique").on(
      table.contract_id,
      table.position,
    ),
    index("contract_milestones_contract_status_idx").on(
      table.contract_id,
      table.status,
    ),
    check("contract_milestones_amount_check", sql`${table.amount} > 0`),
    check("contract_milestones_position_check", sql`${table.position} >= 0`),
  ],
);

export const contractRelations = relations(contracts, ({ many, one }) => ({
  proposal: one(proposals, {
    fields: [contracts.proposal_id],
    references: [proposals.id],
  }),
  job: one(job_posts, {
    fields: [contracts.job_id],
    references: [job_posts.id],
  }),
  client: one(accounts, {
    fields: [contracts.client_id],
    references: [accounts.auth_id],
    relationName: "contract_client",
  }),
  freelancer: one(accounts, {
    fields: [contracts.freelancer_id],
    references: [accounts.auth_id],
    relationName: "contract_freelancer",
  }),
  milestones: many(contract_milestones),
}));

export const contractMilestoneRelations = relations(
  contract_milestones,
  ({ one }) => ({
    contract: one(contracts, {
      fields: [contract_milestones.contract_id],
      references: [contracts.id],
    }),
  }),
);

export const freelancer_earning = pgTable(
  "freelancer_earning",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id")
      .notNull()
      .unique()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    total_earning: numeric("total_earning", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    completed_jobs: integer("completed_jobs").notNull().default(0),
    ongoing_jobs: integer("ongoing_jobs").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
    job_success_score: numeric("job_success_score", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("freelancer_earning_total_check", sql`${table.total_earning} >= 0`),
    check(
      "freelancer_earning_completed_check",
      sql`${table.completed_jobs} >= 0`,
    ),
    check("freelancer_earning_ongoing_check", sql`${table.ongoing_jobs} >= 0`),
    check("freelancer_earning_reviews_check", sql`${table.review_count} >= 0`),
    check(
      "freelancer_earning_success_check",
      sql`${table.job_success_score} BETWEEN 0 AND 100`,
    ),
    check(
      "freelancer_earning_rating_check",
      sql`${table.rating} BETWEEN 0 AND 5`,
    ),
  ],
);

export const agency_earning = pgTable(
  "agency_earning",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agency_id: uuid("agency_id")
      .notNull()
      .unique()
      .references(() => agency_metadata.id, { onDelete: "cascade" }),
    total_earning: numeric("total_earning", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    completed_jobs: integer("completed_jobs").notNull().default(0),
    ongoing_jobs: integer("ongoing_jobs").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
    job_success_score: numeric("job_success_score", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("agency_earning_total_check", sql`${table.total_earning} >= 0`),
    check("agency_earning_completed_check", sql`${table.completed_jobs} >= 0`),
    check("agency_earning_ongoing_check", sql`${table.ongoing_jobs} >= 0`),
    check("agency_earning_reviews_check", sql`${table.review_count} >= 0`),
    check(
      "agency_earning_success_check",
      sql`${table.job_success_score} BETWEEN 0 AND 100`,
    ),
    check("agency_earning_rating_check", sql`${table.rating} BETWEEN 0 AND 5`),
  ],
);

export const earning_history = pgTable(
  "earning_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    freelancer_id: text("freelancer_id").references(() => accounts.auth_id, {
      onDelete: "cascade",
    }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    milestone_id: uuid("milestone_id")
      .notNull()
      .unique()
      .references(() => contract_milestones.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    platform_fee_amount: numeric("platform_fee_amount", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    description: text("description").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("earning_history_freelancer_created_idx").on(
      table.freelancer_id,
      table.created_at,
    ),
    index("earning_history_agency_created_idx").on(
      table.agency_id,
      table.created_at,
    ),
    check("earning_history_amount_check", sql`${table.amount} > 0`),
    check("earning_history_fee_check", sql`${table.platform_fee_amount} >= 0`),
    check(
      "earning_history_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const earningHistoryRelations = relations(
  earning_history,
  ({ one }) => ({
    freelancer: one(accounts, {
      fields: [earning_history.freelancer_id],
      references: [accounts.auth_id],
    }),
    agency: one(agency_metadata, {
      fields: [earning_history.agency_id],
      references: [agency_metadata.id],
    }),
    contract: one(contracts, {
      fields: [earning_history.contract_id],
      references: [contracts.id],
    }),
    milestone: one(contract_milestones, {
      fields: [earning_history.milestone_id],
      references: [contract_milestones.id],
    }),
  }),
);

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
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    stripe_transfer_id: text("stripe_transfer_id").notNull().unique(),
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
    check("payout_history_amount_check", sql`${table.amount} > 0`),
    check(
      "payout_history_owner_check",
      sql`(${table.freelancer_id} IS NOT NULL) <> (${table.agency_id} IS NOT NULL)`,
    ),
  ],
);

export const payoutHistoryRelations = relations(payout_history, ({ one }) => ({
  freelancer: one(accounts, {
    fields: [payout_history.freelancer_id],
    references: [accounts.auth_id],
  }),
  earning: one(earning_history, {
    fields: [payout_history.earning_history_id],
    references: [earning_history.id],
  }),
}));

export const client_spents = pgTable(
  "client_spents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    client_id: text("client_id")
      .notNull()
      .unique()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    total_spent: numeric("total_spent", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    completed_contracts: integer("completed_contracts").notNull().default(0),
    ongoing_contracts: integer("ongoing_contracts").notNull().default(0),
    review_count: integer("review_count").notNull().default(0),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("client_spents_total_check", sql`${table.total_spent} >= 0`),
    check(
      "client_spents_completed_check",
      sql`${table.completed_contracts} >= 0`,
    ),
    check("client_spents_ongoing_check", sql`${table.ongoing_contracts} >= 0`),
    check("client_spents_reviews_check", sql`${table.review_count} >= 0`),
    check("client_spents_rating_check", sql`${table.rating} BETWEEN 0 AND 5`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contract_id: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    reviewer_id: text("reviewer_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    reviewee_id: text("reviewee_id")
      .notNull()
      .references(() => accounts.auth_id, { onDelete: "cascade" }),
    agency_id: uuid("agency_id").references(() => agency_metadata.id, {
      onDelete: "cascade",
    }),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("reviews_contract_reviewer_unique").on(
      table.contract_id,
      table.reviewer_id,
    ),
    index("reviews_reviewee_created_idx").on(
      table.reviewee_id,
      table.created_at,
    ),
    index("reviews_agency_created_idx").on(table.agency_id, table.created_at),
    check("reviews_rating_check", sql`${table.rating} BETWEEN 1 AND 5`),
    check(
      "reviews_different_accounts_check",
      sql`${table.reviewer_id} <> ${table.reviewee_id}`,
    ),
  ],
);

export const freelancerEarningRelations = relations(
  freelancer_earning,
  ({ one }) => ({
    freelancer: one(accounts, {
      fields: [freelancer_earning.freelancer_id],
      references: [accounts.auth_id],
    }),
  }),
);

export const clientSpentsRelations = relations(client_spents, ({ one }) => ({
  client: one(accounts, {
    fields: [client_spents.client_id],
    references: [accounts.auth_id],
  }),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
  contract: one(contracts, {
    fields: [reviews.contract_id],
    references: [contracts.id],
  }),
  reviewer: one(accounts, {
    fields: [reviews.reviewer_id],
    references: [accounts.auth_id],
    relationName: "review_reviewer",
  }),
  reviewee: one(accounts, {
    fields: [reviews.reviewee_id],
    references: [accounts.auth_id],
    relationName: "review_reviewee",
  }),
}));

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
