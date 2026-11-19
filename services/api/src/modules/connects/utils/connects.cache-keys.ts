export const getConnectsCacheKey = (userId: string): string =>
  `connects:${userId}:freelancer`;

export const getAgencyConnectsCacheKey = (agencyId: string): string =>
  `connects:${agencyId}:agency`;
