import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { availableConnects } from "../../middleware/connects.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
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

export const connectsRouter = Router();

connectsRouter.post("/webhook", connectsWebhook);
connectsRouter.use(isAuthenticated, availableConnects);
connectsRouter.get(
  "/",
  validate({ query: roleOnlyQuerySchema }),
  getAvailableConnects,
);
connectsRouter.get(
  "/history",
  validate({ query: roleOnlyQuerySchema }),
  getLoggedInFreelancerConnectsHistory,
);
connectsRouter.post(
  "/checkout",
  validate({ query: roleOnlyQuerySchema, body: buyConnectsBodySchema }),
  buyConnects,
);
