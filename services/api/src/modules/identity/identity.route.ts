import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import {
  identityWebhook,
  startIdentityVerification,
} from "./identity.controller.js";

export const identityRouter = Router();

identityRouter.post("/webhook", identityWebhook);
identityRouter.post("/session", isAuthenticated, startIdentityVerification);
