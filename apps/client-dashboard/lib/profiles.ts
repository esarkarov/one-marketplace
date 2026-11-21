import type { Components } from "@onemarketplace/api-client";
import type { AgencyMember } from "@onemarketplace/web-core";

export type MarketplaceResult =
  Components["schemas"]["ClientMarketplaceResult"];

export type AccountFilter = "all" | "freelancer" | "agency";

export const ACCOUNT_FILTERS: readonly AccountFilter[] = [
  "all",
  "freelancer",
  "agency",
];

export const ACCOUNT_FILTER_LABELS: Readonly<Record<AccountFilter, string>> = {
  all: "All",
  freelancer: "Talent",
  agency: "Agency",
};

export const ACCOUNT_TYPE_LABELS: Readonly<
  Record<MarketplaceResult["accountType"], string>
> = {
  FREELANCER: "Talent",
  AGENCY: "Agency",
};

export const MARKETPLACE_PAGE_SIZE = 20;

export const isAgencyResult = (result: MarketplaceResult): boolean =>
  result.accountType === "AGENCY";

export const accountTypeLabel = (
  accountType: MarketplaceResult["accountType"],
): string => ACCOUNT_TYPE_LABELS[accountType];

export const marketplaceProfileHref = (result: MarketplaceResult): string =>
  `${isAgencyResult(result) ? "/agency" : "/talent"}/${encodeURIComponent(result.id)}`;

export const memberProfileHref = (member: AgencyMember): string | null =>
  member.profileId ? `/talent/${encodeURIComponent(member.profileId)}` : null;

export const nextMarketplaceOffset = (
  lastPage: { hasMore: boolean },
  allPages: readonly unknown[],
): number | undefined =>
  lastPage.hasMore ? allPages.length * MARKETPLACE_PAGE_SIZE : undefined;
