import { Router } from "express";
import {
  createMessage,
  listConversations,
  listMessages,
  openConversation,
  readConversation,
} from "./messaging.controller.js";
import { createMeetingHandler } from "../meetings/meetings.controller.js";
import { isAuthenticated } from "../../middleware/auth.middleware.js";

export const messagingRouter = Router();

messagingRouter.use(isAuthenticated);
messagingRouter.get("/", listConversations);
messagingRouter.post("/", openConversation);
messagingRouter.post("/:conversationId/messages", createMessage);
messagingRouter.get("/:conversationId/messages", listMessages);
messagingRouter.post("/:conversationId/read", readConversation);
messagingRouter.post("/:conversationId/meetings", createMeetingHandler);
