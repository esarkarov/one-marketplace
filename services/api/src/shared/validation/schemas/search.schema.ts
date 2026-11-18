import { z } from "zod";
import {
  SEARCH_OFFSET_MAX,
  SEARCH_QUERY_MAX_LENGTH,
} from "../constants/search.constants.js";

const searchTextParam = z
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
  offset: searchOffsetParam,
};
