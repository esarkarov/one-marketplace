import { RequestHandler } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { ApiResponse } from "../../types/common.types.js";
import {
  ConversationScope,
  createConversation,
  getConversations,
  getMessages,
  markConversationRead,
  sendMessage,
} from "./messaging.service.js";
import { requireClient } from "../proposals/proposals.controller.js";
import { requireText } from "../../config/constants.js";
import { ApiError } from "../../utils/api-error.js";
import {
  assertAttachmentFileName,
  MAX_ATTACHMENTS,
  validateAttachmentBatch,
} from "../../utils/attachments.js";

export interface AttachmentInput {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
}

const getId = (value: unknown, label: string) => {
  const id = requireText(typeof value === "string" ? value : undefined, label);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new ApiError(400, `${label} is invalid.`);
  }
  return id;
};

const optionalId = (value: unknown, label: string) =>
  value === undefined || value === null || value === ""
    ? undefined
    : getId(value, label);

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
    const data = await createConversation(auth.userId, {
      recipientId:
        typeof request.body?.recipientId === "string"
          ? request.body.recipientId.trim()
          : undefined,
      jobId: optionalId(request.body?.jobId, "Job post"),
      proposalId: optionalId(request.body?.proposalId, "Proposal"),
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
    const body =
      typeof request.body?.body === "string" ? request.body.body.trim() : "";
    const rawAttachments: unknown[] = Array.isArray(request.body?.attachments)
      ? request.body.attachments
      : [];

    if (!body && !rawAttachments.length) {
      throw new ApiError(400, "Message or attachment is required.");
    }
    if (body.length > 10_000) {
      throw new ApiError(400, "Message cannot exceed 10,000 characters.");
    }
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      throw new ApiError(400, "A message can contain up to 5 attachments.");
    }

    const candidates = rawAttachments.map((value) => {
      const attachment = value as Record<string, unknown>;
      if (
        !attachment ||
        typeof attachment.fileUrl !== "string" ||
        typeof attachment.fileName !== "string" ||
        !attachment.fileName.trim() ||
        attachment.fileName.length > 255 ||
        !Number.isInteger(attachment.fileSize) ||
        typeof attachment.mimeType !== "string"
      ) {
        throw new ApiError(400, "Attachment metadata is invalid.");
      }

      const fileName = attachment.fileName.trim();
      assertAttachmentFileName(fileName);

      return {
        fileUrl: attachment.fileUrl,
        fileName,
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
      getId(request.params.conversationId, "Conversation"),
      request.auth!.userId,
      {
        body: body || undefined,
        replyToMessageId: optionalId(
          request.body?.replyToMessageId,
          "Reply message",
        ),
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
      getId(request.params.conversationId, "Conversation"),
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
      getId(request.params.conversationId, "Conversation"),
      request.auth!.userId,
      getId(request.body?.lastReadMessageId, "Last read message"),
    );

    response.json({
      success: true,
      message: "Conversation marked as read.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);
