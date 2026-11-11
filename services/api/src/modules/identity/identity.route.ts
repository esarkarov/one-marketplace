import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  identityWebhook,
  startIdentityVerification,
} from "./identity.controller.js";
import { identitySessionQuerySchema } from "./identity.schemas.js";

export const identityRouter = Router();

identityRouter.post("/webhook", identityWebhook);
identityRouter.post(
  "/session",
  isAuthenticated,
  validate({ query: identitySessionQuerySchema }),
  startIdentityVerification,
);
