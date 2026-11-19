import type { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import { createMeetingRequest } from "@/modules/meetings/schemas/meetings.schema.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { ApiResponse } from "@/types/common.types.js";
import { startMeeting } from "@/modules/meetings/services/meetings.service.js";
import { handleDailyWebhook } from "@/modules/meetings/services/meetings.webhook.service.js";

export const createMeetingHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");

    const { params } = getValidated(request, createMeetingRequest);
    const conversationId = params.conversationId;
    if (typeof conversationId !== "string" || !conversationId) {
      throw new ApiError(400, "Conversation id is required.");
    }

    const data = await startMeeting(conversationId, request.auth.userId);

    await request.logger.info({
      message: "Meeting created",
      eventName: "task.meeting.created",
      attributes: {
        "task.meeting.id": data.id,
        "task.meeting.conversation_id": conversationId,
        "user.id": request.auth.userId,
      },
    });

    response.status(201).json({
      success: true,
      message: "Meeting created.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const dailyWebhookHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const outcome = await handleDailyWebhook({
      timestamp: request.headers["x-webhook-timestamp"],
      signature: request.headers["x-webhook-signature"],
      rawBody: request.body,
      logger: request.logger,
    });

    response.status(200).json({
      success: true,
      message:
        outcome === "duplicate"
          ? "Webhook already processed."
          : "Webhook processed.",
    });
  },
);
