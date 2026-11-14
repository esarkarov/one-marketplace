import { Router } from "express";
import { identifyAccount } from "./auth.middleware.js";
import { signUpLimiter } from "../../shared/http/limits/rate-limit.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import { authStatusQuerySchema, signUpBodySchema } from "./auth.schemas.js";
import { authStatusResponses, signUpResponses } from "./auth.responses.js";
import { getAuthStatus, signup } from "./auth.controller.js";

export const authRouter = Router();
authRouter.post(
  "/sign-up",
  signUpLimiter,
  validate({
    body: signUpBodySchema,
    query: {},
    responses: signUpResponses,
  }),
  signup,
);
authRouter.get(
  "/status",
  identifyAccount,
  validate({
    query: authStatusQuerySchema,
    responses: authStatusResponses,
  }),
  getAuthStatus,
);
