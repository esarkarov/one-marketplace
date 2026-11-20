import type { Components } from "@onemarketplace/api-client";

type Schemas = Components["schemas"];

export type Tone = "green" | "amber" | "blue" | "gray" | "red";

export const CONTRACT_STATUS: Record<
  Schemas["AdminContractItem"]["status"],
  { label: string; tone: Tone }
> = {
  PENDING: { label: "Pending", tone: "amber" },
  ACTIVE: { label: "Active", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

export const TALENT_KIND_LABEL: Record<
  Schemas["AdminContractItem"]["talentKind"],
  string
> = {
  AGENCY: "Agency",
  FREELANCER: "Freelancer",
};

export const ACCOUNT_TYPE_LABEL: Record<
  Schemas["AdminAccountItem"]["type"],
  string
> = {
  FREELANCER: "Freelancer",
  CLIENT: "Client",
  AGENCY: "Agency",
};

export const JOB_STATUS_TONE: Record<
  Schemas["AdminJobPostItem"]["status"],
  Tone
> = {
  DRAFT: "gray",
  PUBLISHED: "green",
  HIRED: "amber",
};

export function parseOffset(value: string | undefined): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
