import { RequestHandler } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { ApiResponse } from "../../types/common.types.js";
import {
  ConversationScope,
  createConversation,
  getConversations,
  getMessages,
  markConversationRead,
  sendMessage,
} from "./messaging.service.js";
import { requireClient } from "../../shared/http/auth/role-guards.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  assertAttachmentFileName,
  validateAttachmentBatch,
} from "../../shared/utils/attachments.js";

export interface AttachmentInput {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
}

const requestedScope = (value: unknown): ConversationScope =>
  value === "agency" ? "agency" : "default";

export const listConversations: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getConversations(
      request.auth!.userId,
      requestedScope(request.query.scope),
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
    const { recipientId, jobId, proposalId } = request.body as {
      recipientId?: string;
      jobId?: string | null;
      proposalId?: string | null;
    };
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
    const body = (request.body.body as string | undefined) ?? "";
    const rawAttachments = (request.body.attachments ?? []) as {
      fileUrl: string;
      fileName: string;
      mimeType: string;
    }[];

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
      request.params.conversationId as string,
      request.auth!.userId,
      {
        body: body || undefined,
        replyToMessageId:
          (request.body.replyToMessageId as string | null | undefined) ||
          undefined,
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
    const data = await getMessages(
      request.params.conversationId as string,
      request.auth!.userId,
      typeof request.query.cursor === "string"
        ? request.query.cursor
        : undefined,
      Math.min(Math.max(Number(request.query.limit) || 30, 1), 50),
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
    const data = await markConversationRead(
      request.params.conversationId as string,
      request.auth!.userId,
      request.body.lastReadMessageId as string,
    );

    response.json({
      success: true,
      message: "Conversation marked as read.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);
