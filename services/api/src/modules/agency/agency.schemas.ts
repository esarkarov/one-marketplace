import { z } from "zod";

import { centsQueryParam } from "../../utils/money-schemas.js";
import { searchPagingShape } from "../../utils/search-schemas.js";

export const agencyJobFeedQuerySchema = z.looseObject({
  minBudgetCents: centsQueryParam,
  maxBudgetCents: centsQueryParam,
});

export const agencyTalentSearchQuerySchema = z.looseObject({
  ...searchPagingShape,
  maxRateCents: centsQueryParam,
});
