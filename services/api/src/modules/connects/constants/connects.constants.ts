export const INITIAL_CONNECTS = 60;
export const PROPOSAL_CONNECTS = 6;

export const CONNECTS_CACHE_TTL_SECONDS = 10 * 60;

export const CONNECTS_PLANS = {
  20: 300,
  40: 600,
  80: 1200,
} as const;

export type ConnectsPlan = keyof typeof CONNECTS_PLANS;
