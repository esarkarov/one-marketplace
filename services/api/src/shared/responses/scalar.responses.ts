import { z } from "zod";

import { MAX_MONEY_CENTS } from "../money/money.js";

export const isoDateTime = z.iso
  .datetime({ error: "Expected an ISO 8601 date-time." })
  .meta({ id: "IsoDateTime" });

export const cents = z
  .number()
  .int()
  .min(0)
  .max(MAX_MONEY_CENTS)
  .meta({ id: "Cents" });
