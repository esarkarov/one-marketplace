export const ADMIN_LIMITS = {
  redisPattern: 64,
  redisKey: 128,
  password: 1024,
  streamToken: 2048,
} as const;

export const ADMIN_ACCOUNT_TYPE = {
  FREELANCER: "FREELANCER",
  CLIENT: "CLIENT",
  AGENCY: "AGENCY",
} as const;

export const ADMIN_TALENT_KIND = {
  AGENCY: "AGENCY",
  FREELANCER: "FREELANCER",
} as const;

export type AdminAccountType =
  (typeof ADMIN_ACCOUNT_TYPE)[keyof typeof ADMIN_ACCOUNT_TYPE];
