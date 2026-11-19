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
  createMessageRequest,
  listConversationsRequest,
  listMessagesRequest,
  openConversationRequest,
  readConversationRequest,
} from "./schemas/messaging.schema.js";
import { messagingResponses } from "./responses/messaging.responses.js";

export const messagingRouter = Router();

const sendMessageLimiter = messageWriteLimiter("message-send");

messagingRouter.get(
  "/",
  isAuthenticated,
  validate({ ...listConversationsRequest, responses: messagingResponses.list }),
  listConversations,
);
messagingRouter.post(
  "/",
  isAuthenticated,
  validate({ ...openConversationRequest, responses: messagingResponses.open }),
  openConversation,
);
messagingRouter.post(
  "/:conversationId/messages",
  verifyBearerToken,
  sendMessageLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ ...createMessageRequest, responses: messagingResponses.send }),
  createMessage,
);
messagingRouter.get(
  "/:conversationId/messages",
  isAuthenticated,
  validate({ ...listMessagesRequest, responses: messagingResponses.messages }),
  listMessages,
);
messagingRouter.post(
  "/:conversationId/read",
  isAuthenticated,
  validate({ ...readConversationRequest, responses: messagingResponses.read }),
  readConversation,
);
