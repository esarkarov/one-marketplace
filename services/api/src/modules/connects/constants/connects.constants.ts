export const INITIAL_CONNECTS = 60;
export const PROPOSAL_CONNECTS = 6;

export const CONNECTS_CACHE_TTL_SECONDS = 10 * 60;

export const CONNECTS_OWNER_FOREIGN_KEYS = [
  "connects_freelancer_id_freelancer_metadata_auth_id_fk",
  "connects_agency_id_agency_metadata_id_fk",
] as const;

export const CONNECTS_REFUND = {
  reason: "duplicate",
  cause: "owner_profile_missing",
  keySuffix: ":connects",
} as const;

export const CONNECTS_PLANS = {
  20: 300,
  40: 600,
  80: 1200,
} as const;

export type ConnectsPlan = keyof typeof CONNECTS_PLANS;
