import { z } from "zod";
import {
  ErrorBody,
  isoDateTime,
  ok,
} from "../../shared/validation/response-schemas.js";

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
