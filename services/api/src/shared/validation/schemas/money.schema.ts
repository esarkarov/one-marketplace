import { z } from "zod";
import { moneyCents } from "../../money/money.js";

export const centsQueryParam = z
  .string()
  .regex(/^\d+$/, {
    error: "Amount filter must be an integer number of cents.",
  })
  .transform(Number)
  .pipe(moneyCents)
  .optional();
