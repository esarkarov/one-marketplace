import { Router } from "express";
import { isAuthenticated } from "@/modules/auth/index.js";
import { validate } from "@/middleware/validate/validate.middleware.js";
import {
  identityWebhook,
  startIdentityVerification,
} from "./controllers/identity.controller.js";
import { identityResponses } from "./responses/identity.responses.js";
import { identitySessionRequest } from "./schemas/identity.schema.js";

export const identityRouter = Router();

identityRouter.post("/webhook", identityWebhook);
identityRouter.post(
  "/session",
  isAuthenticated,
  validate({ ...identitySessionRequest, responses: identityResponses.session }),
  startIdentityVerification,
);
