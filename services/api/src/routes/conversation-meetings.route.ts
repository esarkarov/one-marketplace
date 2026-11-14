import { Router } from "express";
import { isAuthenticated } from "../modules/auth/index.js";
import { validate } from "../shared/http/validate.middleware.js";
import { createMeetingHandler } from "../modules/meetings/controllers/meetings.controller.js";
import { meetingsResponses } from "../modules/meetings/responses/meetings.responses.js";
import {
  createMeetingParamsSchema,
  createMeetingQuerySchema,
} from "../modules/meetings/schemas/meetings.schema.js";

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
