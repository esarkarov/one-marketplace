import { Pagination, PaginatedResult } from "../types/admin.types.js";

export const mergePages = <T extends { createdAt: Date | null }>(
  sources: T[][],
  { limit, offset }: Pagination,
): PaginatedResult<T> => {
  const merged = sources
    .flat()
    .filter((item): item is T & { createdAt: Date } => Boolean(item.createdAt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    results: merged.slice(offset, offset + limit),
    hasMore: merged.length > offset + limit,
  };
};
