import { z } from "zod";
import { ErrorBody, ok } from "@/shared/responses/api-envelope.responses.js";
import { isoDateTime } from "@/shared/responses/scalar.responses.js";

export const meetingsResponses = {
  create: {
    201: ok(
      z.strictObject({
        id: z.uuid(),
        joinUrl: z.string(),
        startedAt: isoDateTime,
      }),
    ),
    404: ErrorBody,
  },
};
