import { z } from "zod";

import { moneyCents } from "./money.js";

export const MAX_BID_CENTS = 100_000_000;

export const submitProposalBodySchema = z.looseObject(
  {
    bidAmountCents: moneyCents
      .min(1, { error: "Enter a valid bid amount." })
      .max(MAX_BID_CENTS, { error: "Enter a valid bid amount." }),
  },
  { error: "Request body must be an object." },
);

export const centsQueryParam = z
  .string()
  .regex(/^\d+$/, {
    error: "Amount filter must be an integer number of cents.",
  })
  .transform(Number)
  .pipe(moneyCents)
  .optional();
