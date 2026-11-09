import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { getAuthStatus, signup } from "./auth.controller.js";

export const authRouter = Router();
authRouter.post("/sign-up", signup);
authRouter.get("/status", isAuthenticated, getAuthStatus);
