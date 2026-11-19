import { Router } from "express";
import { validate } from "@/middleware/validate/validate.middleware.js";
import {
  healthHandler,
  readinessHandler,
} from "./controllers/health.controller.js";
import { healthResponses } from "./responses/health.responses.js";

export const healthRouter = Router();
export const readinessRouter = Router();

healthRouter.get(
  "/",
  validate({ query: {}, responses: healthResponses.health }),
  healthHandler,
);

readinessRouter.get(
  "/",
  validate({ query: {}, responses: healthResponses.ready }),
  readinessHandler,
);
