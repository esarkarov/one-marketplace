import { z } from "zod";
import {
  errorCodeEnum,
  ok,
  requestIdField,
} from "@/shared/responses/api-envelope.responses.js";

export const identityResponses = {
  session: {
    200: ok(z.strictObject({ url: z.string() })),
    409: z.strictObject({
      success: z.literal(false),
      message: z.string(),
      code: errorCodeEnum(),
      requestId: requestIdField,
    }),
  },
};
