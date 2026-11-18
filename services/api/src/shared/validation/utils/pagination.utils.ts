export const fetchSize = (limit: number) => limit + 1;

export const toOffsetPage = <T>(rows: readonly T[], limit: number) => ({
  rows: rows.slice(0, limit),
  hasMore: rows.length > limit,
});
