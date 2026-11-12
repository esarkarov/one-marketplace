import { z } from "zod";
import { isoDateTime, ok } from "../utils/response-schemas.js";

export const healthResponses = {
  health: {
    200: ok(
      z.strictObject({
        service: z.string(),
        status: z.literal("healthy"),
        timestamp: isoDateTime,
      }),
    ),
  },
  ready: {
    200: ok(
      z.strictObject({
        status: z.literal("ready"),
        checks: z.strictObject({
          postgres: z.literal("ok"),
          redis: z.literal("ok"),
        }),
      }),
    ),
    503: z.strictObject({
      success: z.literal(false),
      message: z.literal("Service is not ready"),
      data: z.strictObject({
        status: z.literal("not_ready"),
        checks: z.strictObject({
          postgres: z.enum(["ok", "failed"]),
          redis: z.enum(["ok", "failed"]),
        }),
      }),
    }),
  },
};
