import { pgEnum } from "drizzle-orm/pg-core";

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
