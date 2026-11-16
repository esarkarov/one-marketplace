import { Router } from "express";
import { isAuthenticated } from "../auth/index.js";
import { availableConnects } from "./middleware/connects.middleware.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  buyConnects,
  connectsWebhook,
  getAvailableConnects,
  getLoggedInFreelancerConnectsHistory,
} from "./controllers/connects.controller.js";
import {
  buyConnectsBodySchema,
  roleOnlyQuerySchema,
} from "./schemas/connects.schema.js";
import { connectsResponses } from "./responses/connects.responses.js";

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
