import { z } from "zod";
import { SEARCH_QUERY_MAX_LENGTH } from "../constants/search.constants.js";
import { limitParam, offsetParam } from "./pagination.schema.js";

const searchTextParam = z
  .string()
  .max(SEARCH_QUERY_MAX_LENGTH, {
    error: `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`,
  })
  .optional();

export const searchPagingShape = {
  query: searchTextParam,
  limit: limitParam(),
  offset: offsetParam,
};
