import { Router } from "express";
import { isAuthenticated } from "../../shared/http/auth.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import {
  identityWebhook,
  startIdentityVerification,
} from "./identity.controller.js";
import { identityResponses } from "./identity.responses.js";
import { identitySessionQuerySchema } from "./identity.schemas.js";

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
