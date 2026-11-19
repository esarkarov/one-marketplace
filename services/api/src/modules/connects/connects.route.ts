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
  buyConnectsRequest,
  connectsHistoryRequest,
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
  validate({ ...connectsHistoryRequest, responses: connectsResponses.history }),
  getLoggedInFreelancerConnectsHistory,
);
connectsRouter.post(
  "/checkout",
  validate({ ...buyConnectsRequest, responses: connectsResponses.checkout }),
  buyConnects,
);
