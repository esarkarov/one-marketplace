import {
  Pagination,
  PaginatedResult,
} from "@/modules/admin/types/admin.types.js";

const compareIdsDescending = (a: string, b: string) =>
  a < b ? 1 : a > b ? -1 : 0;

export const mergePages = <T extends { id: string; createdAt: Date | null }>(
  sources: T[][],
  { limit, offset }: Pagination,
): PaginatedResult<T> => {
  const merged = sources
    .flat()
    .filter((item): item is T & { createdAt: Date } => Boolean(item.createdAt))
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        compareIdsDescending(a.id, b.id),
    );
  return {
    results: merged.slice(offset, offset + limit),
    hasMore: merged.length > offset + limit,
  };
};
