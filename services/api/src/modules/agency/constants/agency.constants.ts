export const AGENCY_LIMITS = {
  nameMax: 100,
  professionalTitleMax: 100,
  specialtyMax: 100,
  sizeMax: 50,
  overviewMax: 5000,
  tagsMaxItems: 15,
  tagMaxLength: 20,
  portfolioMaxItems: 10,
  portfolioTitleMax: 100,
  portfolioCategoryMax: 100,
  portfolioDescriptionMax: 2000,
  websiteMax: 2048,
} as const;

export const MEMBER_ROLE = {
  AGENCY_MEMBER: "AGENCY_MEMBER",
  BUSINESS_MANAGER: "BUSINESS_MANAGER",
} as const;

export type MemberRole = (typeof MEMBER_ROLE)[keyof typeof MEMBER_ROLE];

export const STORED_MEMBER_ROLE = {
  AGENCY_MEMBER: "Agency member",
  BUSINESS_MANAGER: "Business manager",
} as const satisfies Record<MemberRole, string>;

export const toStoredMemberRole = (role: MemberRole): string =>
  STORED_MEMBER_ROLE[role];

export const toApiMemberRole = (stored: string): string =>
  Object.values(MEMBER_ROLE).find(
    (role) => STORED_MEMBER_ROLE[role] === stored,
  ) ?? stored;
