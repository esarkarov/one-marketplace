import { z } from "zod";

import { centsQueryParam } from "../../utils/money-schemas.js";

export const agencyJobFeedQuerySchema = z.looseObject({
  minBudgetCents: centsQueryParam,
  maxBudgetCents: centsQueryParam,
});

export const agencyTalentSearchQuerySchema = z.looseObject({
  maxRateCents: centsQueryParam,
});
