import { z } from "zod";

import { moneyCents } from "../../utils/money.js";
import { centsQueryParam } from "../../utils/money-schemas.js";
import { searchPagingShape } from "../../utils/search-schemas.js";

export const MIN_HOURLY_RATE_CENTS = 500;
export const MAX_HOURLY_RATE_CENTS = 100_000;

export const upsertProfileBodySchema = z.looseObject(
  {
    freelancer_metadata: z.looseObject({
      hourly_rate_cents: moneyCents
        .min(MIN_HOURLY_RATE_CENTS, {
          error: "Hourly rate must be between 5 and 1000$.",
        })
        .max(MAX_HOURLY_RATE_CENTS, {
          error: "Hourly rate must be between 5 and 1000$.",
        }),
    }),
  },
  { error: "Request body must be an object." },
);

export const jobFeedQuerySchema = z.looseObject({
  minBudgetCents: centsQueryParam,
  maxBudgetCents: centsQueryParam,
});

export const talentSearchQuerySchema = z.looseObject({
  ...searchPagingShape,
  minRateCents: centsQueryParam,
  maxRateCents: centsQueryParam,
});
