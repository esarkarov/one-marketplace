import { Router } from "express";
import { isAuthenticated } from "../shared/http/auth.middleware.js";
import { validate } from "../shared/http/validate.middleware.js";
import { createMeetingHandler } from "../modules/meetings/meetings.controller.js";
import { meetingsResponses } from "../modules/meetings/meetings.responses.js";
import {
  createMeetingParamsSchema,
  createMeetingQuerySchema,
} from "../modules/meetings/meetings.schemas.js";

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
