export const getAccountAuthCacheKey = (
  userId: string,
  role: "client" | "freelancer",
): string => `account:auth:${userId}:${role}`;

export const getAccountAuthCacheKeys = (userId: string): string[] => [
  getAccountAuthCacheKey(userId, "client"),
  getAccountAuthCacheKey(userId, "freelancer"),
];
