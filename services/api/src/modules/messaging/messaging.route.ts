import { Router } from "express";
import {
  createMessage,
  listConversations,
  listMessages,
  openConversation,
  readConversation,
} from "./messaging.controller.js";
import { createMeetingHandler } from "../meetings/meetings.controller.js";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";

export const messagingRouter = Router();

messagingRouter.get("/", isAuthenticated, listConversations);
messagingRouter.post("/", isAuthenticated, openConversation);
messagingRouter.post(
  "/:conversationId/messages",
  verifyBearerToken,
  largeJsonBody,
  resolveAccountRole,
  createMessage,
);
messagingRouter.get("/:conversationId/messages", isAuthenticated, listMessages);
messagingRouter.post(
  "/:conversationId/read",
  isAuthenticated,
  readConversation,
);
messagingRouter.post(
  "/:conversationId/meetings",
  isAuthenticated,
  createMeetingHandler,
);
