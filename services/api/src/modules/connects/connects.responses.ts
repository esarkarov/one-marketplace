import { z } from "zod";
import {
  ErrorBody,
  isoDateTime,
  ok,
} from "../../shared/validation/response-schemas.js";

const HistoryEntry = z
  .strictObject({
    id: z.uuid(),
    type: z.string(),
    description: z.string(),
    amount: z.number().int(),
    created_at: isoDateTime.nullable(),
  })
  .meta({ id: "ConnectsHistoryEntry" });

export const connectsResponses = {
  balance: {
    200: ok(z.strictObject({ connects: z.number().int().min(0) })),
    403: ErrorBody,
  },
  history: {
    200: ok(z.array(HistoryEntry)),
    403: ErrorBody,
  },
  checkout: {
    200: ok(z.strictObject({ url: z.string() })),
    403: ErrorBody,
  },
};
