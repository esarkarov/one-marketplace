import { z } from "zod";

export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_OFFSET_MAX = 10_000;

export const searchTextParam = z
  .string()
  .max(SEARCH_QUERY_MAX_LENGTH, {
    error: `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`,
  })
  .optional();

export const searchOffsetParam = z
  .string()
  .regex(/^\d+$/, { error: "Offset must be a non-negative integer." })
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .max(SEARCH_OFFSET_MAX, {
        error: `Offset must be at most ${SEARCH_OFFSET_MAX}.`,
      }),
  )
  .optional();

export const searchPagingShape = {
  query: searchTextParam,
  q: searchTextParam,
  offset: searchOffsetParam,
};
