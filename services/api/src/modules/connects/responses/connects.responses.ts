import { z } from "zod";
import {
  ErrorBody,
  offsetPage,
  ok,
} from "@/shared/responses/api-envelope.responses.js";
import { isoDateTime } from "@/shared/responses/scalar.responses.js";

const HistoryEntry = z
  .strictObject({
    id: z.uuid(),
    type: z.string(),
    description: z.string(),
    connects: z.number().int(),
    createdAt: isoDateTime.nullable(),
  })
  .meta({ id: "ConnectsHistoryEntry" });

export const connectsResponses = {
  balance: {
    200: ok(z.strictObject({ connects: z.number().int().min(0) })),
    403: ErrorBody,
  },
  history: {
    200: ok(offsetPage(HistoryEntry)),
    403: ErrorBody,
  },
  checkout: {
    200: ok(z.strictObject({ url: z.string() })),
    403: ErrorBody,
    404: ErrorBody,
  },
};
