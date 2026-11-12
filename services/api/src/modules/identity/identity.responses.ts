import { z } from "zod";
import { ok } from "../../shared/validation/response-schemas.js";

export const identityResponses = {
  session: {
    200: ok(z.strictObject({ url: z.string() })),
    409: z.strictObject({
      success: z.literal(false),
      message: z.string(),
    }),
  },
};
