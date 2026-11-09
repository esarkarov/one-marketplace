import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { signUpLimiter } from "../../middleware/rate-limit.middleware.js";
import { getAuthStatus, signup } from "./auth.controller.js";

export const authRouter = Router();
authRouter.post("/sign-up", signUpLimiter, signup);
authRouter.get("/status", isAuthenticated, getAuthStatus);
