import { Router } from "express";
import {
  createMessage,
  listConversations,
  listMessages,
  openConversation,
  readConversation,
} from "./controllers/messaging.controller.js";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../auth/index.js";
import { largeJsonBody } from "../../middleware/json-body/json-body.middleware.js";
import { messageWriteLimiter } from "../../middleware/rate-limit/user-rate-limit.middleware.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  conversationParamsSchema,
  createMessageBodySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  openConversationBodySchema,
  readConversationBodySchema,
  roleOnlyQuerySchema,
} from "./schemas/messaging.schema.js";
import { messagingResponses } from "./responses/messaging.responses.js";

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
