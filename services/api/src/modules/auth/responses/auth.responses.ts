import { z } from "zod";
import {
  BadRequestBody,
  ok,
} from "@/shared/responses/api-envelope.responses.js";

export const AuthStatus = z
  .strictObject({
    role: z.enum(["client", "freelancer"]),
    accountExists: z.boolean(),
    accountId: z.uuid().nullable(),
    isOnboarded: z.boolean(),
  })
  .meta({ id: "AuthStatus" });

export const authStatusResponses = { 200: ok(AuthStatus) };

export const signUpResponses = {
  201: ok(AuthStatus),
  400: BadRequestBody,
};
