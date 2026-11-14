import { Router } from "express";
import { isAuthenticated } from "../auth/index.js";
import { validate } from "../../shared/http/validate.middleware.js";
import {
  identityWebhook,
  startIdentityVerification,
} from "./controllers/identity.controller.js";
import { identityResponses } from "./responses/identity.responses.js";
import { identitySessionQuerySchema } from "./schemas/identity.schema.js";

export const identityRouter = Router();

identityRouter.post("/webhook", identityWebhook);
identityRouter.post(
  "/session",
  isAuthenticated,
  validate({
    query: identitySessionQuerySchema,
    responses: identityResponses.session,
  }),
  startIdentityVerification,
);
