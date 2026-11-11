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
  createMeetingParamsSchema,
  createMeetingQuerySchema,
} from "../meetings/meetings.schemas.js";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
import { messageWriteLimiter } from "../../middleware/user-rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  conversationParamsSchema,
  createMessageBodySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  openConversationBodySchema,
  readConversationBodySchema,
  roleOnlyQuerySchema,
} from "./messaging.schemas.js";

export const messagingRouter = Router();

const sendMessageLimiter = messageWriteLimiter();

messagingRouter.get(
  "/",
  isAuthenticated,
  validate({ query: listConversationsQuerySchema }),
  listConversations,
);
messagingRouter.post(
  "/",
  isAuthenticated,
  validate({
    query: roleOnlyQuerySchema,
    body: openConversationBodySchema,
  }),
  openConversation,
);
messagingRouter.post(
  "/:conversationId/messages",
  verifyBearerToken,
  sendMessageLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({
    params: conversationParamsSchema,
    query: roleOnlyQuerySchema,
    body: createMessageBodySchema,
  }),
  createMessage,
);
messagingRouter.get(
  "/:conversationId/messages",
  isAuthenticated,
  validate({
    params: conversationParamsSchema,
    query: listMessagesQuerySchema,
  }),
  listMessages,
);
messagingRouter.post(
  "/:conversationId/read",
  isAuthenticated,
  validate({
    params: conversationParamsSchema,
    query: roleOnlyQuerySchema,
    body: readConversationBodySchema,
  }),
  readConversation,
);
messagingRouter.post(
  "/:conversationId/meetings",
  isAuthenticated,
  validate({
    params: createMeetingParamsSchema,
    query: createMeetingQuerySchema,
  }),
  createMeetingHandler,
);
