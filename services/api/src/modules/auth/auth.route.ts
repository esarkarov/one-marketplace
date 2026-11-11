import { Router } from "express";
import { identifyAccount } from "../../middleware/auth.middleware.js";
import { signUpLimiter } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { authStatusQuerySchema, signUpBodySchema } from "./auth.schemas.js";
import { getAuthStatus, signup } from "./auth.controller.js";

export const authRouter = Router();
authRouter.post(
  "/sign-up",
  signUpLimiter,
  validate({ body: signUpBodySchema, query: {} }),
  signup,
);
authRouter.get(
  "/status",
  identifyAccount,
  validate({ query: authStatusQuerySchema }),
  getAuthStatus,
);
