export const CLIENT_LIMITS = {
  professionalRoleMax: 100,
  companyNameMax: 100,
  industryMax: 100,
  companySizeMax: 50,
  companyDescriptionMax: 5000,
  websiteMax: 2048,
} as const;

export const MARKETPLACE_ACCOUNT_TYPE = {
  FREELANCER: "FREELANCER",
  AGENCY: "AGENCY",
} as const;

export type MarketplaceAccountType =
  (typeof MARKETPLACE_ACCOUNT_TYPE)[keyof typeof MARKETPLACE_ACCOUNT_TYPE];
