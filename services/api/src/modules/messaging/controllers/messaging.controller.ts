import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import {
  createMessageRequest,
  listConversationsRequest,
  listMessagesRequest,
  openConversationRequest,
  readConversationRequest,
} from "../schemas/messaging.schema.js";
import { ApiResponse } from "../../../types/common.types.js";
import {
  createConversation,
  getConversations,
} from "../services/messaging.conversations.service.js";
import {
  getMessages,
  markConversationRead,
  sendMessage,
} from "../services/messaging.messages.service.js";
import {
  AttachmentInput,
  ConversationScope,
} from "../types/messaging.types.js";
import { requireClient } from "../../../middleware/auth/role-guards.middleware.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import {
  assertAttachmentFileName,
  validateAttachmentBatch,
} from "../../../shared/uploads/attachments.js";

const requestedScope = (value: unknown): ConversationScope =>
  value === "agency" ? "agency" : "default";

export const listConversations: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, listConversationsRequest);
    const data = await getConversations(
      request.auth!.userId,
      requestedScope(query.scope),
      {
        limit: query.limit,
        offset: query.offset,
      },
    );
    response.json({
      success: true,
      message: "Conversations retrieved.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const openConversation: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireClient(request);
    const { body } = getValidated(request, openConversationRequest);
    const { recipientId, jobId, proposalId } = body;
    const data = await createConversation(auth.userId, {
      recipientId,
      jobId: jobId || undefined,
      proposalId: proposalId || undefined,
    });

    response.status(201).json({
      success: true,
      message: "Conversation ready.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const createMessage: RequestHandler = asyncHandler(
  async (request, response) => {
    const { params, body: input } = getValidated(request, createMessageRequest);
    const body = input.body ?? "";
    const rawAttachments = input.attachments ?? [];

    if (!body && !rawAttachments.length) {
      throw new ApiError(400, "Message or attachment is required.");
    }

    const candidates = rawAttachments.map((attachment) => {
      assertAttachmentFileName(attachment.fileName);

      return {
        fileUrl: attachment.fileUrl,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      };
    });

    const validated = validateAttachmentBatch(candidates, {
      tooManyMessage: "A message can contain up to 5 attachments.",
      nonDataMessage: "Attachment file is invalid.",
    });

    const attachments: AttachmentInput[] = candidates.map(
      (candidate, index) => {
        const { mimeType, size } = validated[index]!;
        return {
          fileId: "",
          fileUrl: candidate.fileUrl,
          fileName: candidate.fileName,
          mimeType,
          fileSize: size,
          attachmentType: mimeType.startsWith("image/") ? "IMAGE" : "FILE",
        };
      },
    );

    const data = await sendMessage(
      params.conversationId,
      request.auth!.userId,
      {
        body: body || undefined,
        replyToMessageId: input.replyToMessageId || undefined,
        attachments,
      },
    );

    response.status(201).json({
      success: true,
      message: "Message sent.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const listMessages: RequestHandler = asyncHandler(
  async (request, response) => {
    const { params, query } = getValidated(request, listMessagesRequest);
    const data = await getMessages(
      params.conversationId,
      request.auth!.userId,
      query.cursor,
      query.limit,
    );

    response.json({
      success: true,
      message: "Messages retrieved.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const readConversation: RequestHandler = asyncHandler(
  async (request, response) => {
    const { params, body } = getValidated(request, readConversationRequest);
    const data = await markConversationRead(
      params.conversationId,
      request.auth!.userId,
      body.lastReadMessageId,
    );

    response.json({
      success: true,
      message: "Conversation marked as read.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);
