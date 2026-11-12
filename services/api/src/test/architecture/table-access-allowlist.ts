export type TableAccessEntry =
  | { importer: string; owner: string; access: "read" }
  | {
      importer: string;
      owner: string;
      access: "write";
      knownDebt: true;
      reason: string;
    };

export const tableAccessAllowlist: TableAccessEntry[] = [
  {
    importer: "client",
    owner: "auth",
    access: "write",
    knownDebt: true,
    reason:
      "client marks onboarding complete inside its profile transaction and stores the Stripe customer id on accounts",
  },
  {
    importer: "connects",
    owner: "auth",
    access: "write",
    knownDebt: true,
    reason:
      "connects stores accounts.stripe_customer_id when it creates a Stripe customer for a purchase",
  },
  {
    importer: "contracts",
    owner: "auth",
    access: "write",
    knownDebt: true,
    reason:
      "contracts stores accounts.stripe_customer_id at checkout and sets paymentMethodVerified inside the offer transaction",
  },
  {
    importer: "contracts",
    owner: "jobs",
    access: "write",
    knownDebt: true,
    reason:
      "addContractMilestone updates job_posts milestones and total_budget_cents inside its FOR UPDATE transaction",
  },
  {
    importer: "contracts",
    owner: "messaging",
    access: "write",
    knownDebt: true,
    reason:
      "the contracts repository writes system-event messages, last-message and unread counts inside contract transactions",
  },
  {
    importer: "freelancer",
    owner: "auth",
    access: "write",
    knownDebt: true,
    reason:
      "freelancer stores accounts.stripe_connect_account_id and marks onboarding complete inside its profile transaction",
  },
  {
    importer: "identity",
    owner: "auth",
    access: "write",
    knownDebt: true,
    reason:
      "identity sets accounts.identityVerified from the Stripe Identity webhook",
  },
  {
    importer: "proposals",
    owner: "connects",
    access: "write",
    knownDebt: true,
    reason:
      "proposals spends and refunds connects and writes connects_history inside its proposal transactions",
  },
  {
    importer: "proposals",
    owner: "messaging",
    access: "write",
    knownDebt: true,
    reason:
      "proposals creates conversations, participants and system messages inside its proposal transactions",
  },
  { importer: "admin", owner: "agency", access: "read" },
  { importer: "admin", owner: "auth", access: "read" },
  { importer: "admin", owner: "client", access: "read" },
  { importer: "admin", owner: "connects", access: "read" },
  { importer: "admin", owner: "contracts", access: "read" },
  { importer: "admin", owner: "jobs", access: "read" },
  { importer: "admin", owner: "payouts", access: "read" },
  { importer: "admin", owner: "proposals", access: "read" },
  { importer: "agency", owner: "auth", access: "read" },
  { importer: "agency", owner: "client", access: "read" },
  { importer: "agency", owner: "contracts", access: "read" },
  { importer: "agency", owner: "freelancer", access: "read" },
  { importer: "agency", owner: "payouts", access: "read" },
  { importer: "client", owner: "agency", access: "read" },
  { importer: "client", owner: "contracts", access: "read" },
  { importer: "client", owner: "freelancer", access: "read" },
  { importer: "client", owner: "jobs", access: "read" },
  { importer: "client", owner: "messaging", access: "read" },
  { importer: "client", owner: "proposals", access: "read" },
  { importer: "contracts", owner: "agency", access: "read" },
  { importer: "contracts", owner: "client", access: "read" },
  { importer: "contracts", owner: "proposals", access: "read" },
  { importer: "freelancer", owner: "agency", access: "read" },
  { importer: "freelancer", owner: "client", access: "read" },
  { importer: "freelancer", owner: "contracts", access: "read" },
  { importer: "freelancer", owner: "jobs", access: "read" },
  { importer: "freelancer", owner: "payouts", access: "read" },
  { importer: "freelancer", owner: "proposals", access: "read" },
  { importer: "jobs", owner: "auth", access: "read" },
  { importer: "jobs", owner: "client", access: "read" },
  { importer: "jobs", owner: "contracts", access: "read" },
  { importer: "jobs", owner: "proposals", access: "read" },
  { importer: "messaging", owner: "agency", access: "read" },
  { importer: "messaging", owner: "auth", access: "read" },
  { importer: "messaging", owner: "client", access: "read" },
  { importer: "messaging", owner: "contracts", access: "read" },
  { importer: "messaging", owner: "freelancer", access: "read" },
  { importer: "messaging", owner: "jobs", access: "read" },
  { importer: "messaging", owner: "meetings", access: "read" },
  { importer: "messaging", owner: "proposals", access: "read" },
  { importer: "payouts", owner: "agency", access: "read" },
  { importer: "payouts", owner: "auth", access: "read" },
  { importer: "payouts", owner: "contracts", access: "read" },
  { importer: "proposals", owner: "agency", access: "read" },
  { importer: "proposals", owner: "auth", access: "read" },
  { importer: "proposals", owner: "client", access: "read" },
  { importer: "proposals", owner: "contracts", access: "read" },
  { importer: "proposals", owner: "freelancer", access: "read" },
  { importer: "proposals", owner: "jobs", access: "read" },
  { importer: "shared/http/auth", owner: "auth", access: "read" },
];
