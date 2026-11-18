import { SEARCH_OFFSET_MAX } from "./search.constants.js";

export const PAGINATION = {
  defaultLimit: 20,
  minLimit: 1,
  maxLimit: 100,
  defaultOffset: 0,
  minOffset: 0,
  maxOffset: SEARCH_OFFSET_MAX,
} as const;
