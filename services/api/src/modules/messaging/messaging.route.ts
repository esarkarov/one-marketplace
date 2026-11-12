import { Router } from "express";
import {
  createMessage,
  listConversations,
  listMessages,
  openConversation,
  readConversation,
} from "./messaging.controller.js";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../shared/http/auth.middleware.js";
import { largeJsonBody } from "../../shared/http/json-body.middleware.js";
import { messageWriteLimiter } from "../../shared/http/user-rate-limit.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import {
  conversationParamsSchema,
  createMessageBodySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  openConversationBodySchema,
  readConversationBodySchema,
  roleOnlyQuerySchema,
} from "./messaging.schemas.js";
import { messagingResponses } from "./messaging.responses.js";

export const messagingRouter = Router();

const sendMessageLimiter = messageWriteLimiter();

messagingRouter.get(
  "/",
  isAuthenticated,
  validate({
    query: listConversationsQuerySchema,
    responses: messagingResponses.list,
  }),
  listConversations,
);
messagingRouter.post(
  "/",
  isAuthenticated,
  validate({
    query: roleOnlyQuerySchema,
    body: openConversationBodySchema,
    responses: messagingResponses.open,
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
    responses: messagingResponses.send,
  }),
  createMessage,
);
messagingRouter.get(
  "/:conversationId/messages",
  isAuthenticated,
  validate({
    params: conversationParamsSchema,
    query: listMessagesQuerySchema,
    responses: messagingResponses.messages,
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
    responses: messagingResponses.read,
  }),
  readConversation,
);
