import { Router } from "express";
import { validate } from "../../middleware/validate/validate.middleware.js";
import { isAuthenticated } from "../auth/index.js";
import {
  createMeetingHandler,
  dailyWebhookHandler,
} from "./controllers/meetings.controller.js";
import { meetingsResponses } from "./responses/meetings.responses.js";
import {
  createMeetingParamsSchema,
  createMeetingQuerySchema,
} from "./schemas/meetings.schema.js";

export const meetingsRouter = Router();

meetingsRouter.post("/webhook", dailyWebhookHandler);

export const conversationMeetingsRouter = Router();

conversationMeetingsRouter.post(
  "/:conversationId/meetings",
  isAuthenticated,
  validate({
    params: createMeetingParamsSchema,
    query: createMeetingQuerySchema,
    responses: meetingsResponses.create,
  }),
  createMeetingHandler,
);
