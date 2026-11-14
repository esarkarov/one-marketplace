import { Router } from "express";
import { isAuthenticated } from "../auth/auth.public.js";
import { availableConnects } from "./connects.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import {
  buyConnects,
  connectsWebhook,
  getAvailableConnects,
  getLoggedInFreelancerConnectsHistory,
} from "./connects.controller.js";
import {
  buyConnectsBodySchema,
  roleOnlyQuerySchema,
} from "./connects.schemas.js";
import { connectsResponses } from "./connects.responses.js";

export const connectsRouter = Router();

connectsRouter.post("/webhook", connectsWebhook);
connectsRouter.use(isAuthenticated, availableConnects);
connectsRouter.get(
  "/",
  validate({
    query: roleOnlyQuerySchema,
    responses: connectsResponses.balance,
  }),
  getAvailableConnects,
);
connectsRouter.get(
  "/history",
  validate({
    query: roleOnlyQuerySchema,
    responses: connectsResponses.history,
  }),
  getLoggedInFreelancerConnectsHistory,
);
connectsRouter.post(
  "/checkout",
  validate({
    query: roleOnlyQuerySchema,
    body: buyConnectsBodySchema,
    responses: connectsResponses.checkout,
  }),
  buyConnects,
);
