import { createHmac, timingSafeEqual } from "crypto";
import type { Request, RequestHandler } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { ApiError } from "../../shared/http/api-error.js";
import { ApiResponse } from "../../types/common.types.js";
import { env } from "../../config/env.js";
import { redis } from "../../infrastructure/redis.js";
import { errorLogAttributes } from "../../shared/utils/sanitize-log.js";
import { endMeetingByRoomName, startMeeting } from "./meetings.service.js";

export const createMeetingHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");

    const conversationId = request.params.conversationId;
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

interface DailyMeetingEndedEvent {
  id?: unknown;
  type: string;
  payload?: { room?: string };
}

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const SECONDS_THRESHOLD = 1e12;
const DEDUPE_TTL_SECONDS = 10 * 60;
const DEDUPE_TIMEOUT_MS = 2_000;

const isFreshTimestamp = (timestamp: string): boolean => {
  if (!/^\d+$/.test(timestamp)) return false;

  const value = Number(timestamp);
  if (!Number.isSafeInteger(value)) return false;

  const milliseconds = value < SECONDS_THRESHOLD ? value * 1000 : value;
  return Math.abs(Date.now() - milliseconds) <= TIMESTAMP_TOLERANCE_MS;
};

const signaturesMatch = (
  secret: Buffer,
  signedPayload: Buffer,
  signature: string,
): boolean => {
  const expected = Buffer.from(
    createHmac("sha256", secret).update(signedPayload).digest("base64"),
  );
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};

const verifyDailySignature = (
  rawBody: Buffer,
  timestamp: string,
  signature: string,
): boolean => {
  if (!env.dailyWebhookSecret) return false;
  if (!isFreshTimestamp(timestamp)) return false;

  const secret = Buffer.from(env.dailyWebhookSecret, "base64");
  const raw = rawBody.toString("utf8");

  const prefix = Buffer.from(`${timestamp}.`);

  if (signaturesMatch(secret, Buffer.concat([prefix, rawBody]), signature)) {
    return true;
  }

  let parsedEvent: unknown;
  try {
    parsedEvent = JSON.parse(raw);
  } catch {
    return false;
  }

  return signaturesMatch(
    secret,
    Buffer.from(`${timestamp}.${JSON.stringify(parsedEvent)}`),
    signature,
  );
};

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Redis operation timed out")),
      DEDUPE_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const logDedupeUnavailable = (logger: Request["logger"], error: unknown) =>
  logger.warn({
    message: "Webhook deduplication unavailable",
    eventName: "webhook.inbound.dedupe_unavailable",
    attributes: {
      "webhook.source": "daily",
      ...errorLogAttributes(error),
    },
  });

const claimEvent = async (
  logger: Request["logger"],
  key: string,
): Promise<"claimed" | "duplicate" | "unavailable"> => {
  try {
    if (!redis.isReady) throw new Error("Redis is not connected");
    const result = await withTimeout(
      redis.set(key, "1", {
        condition: "NX",
        expiration: { type: "EX", value: DEDUPE_TTL_SECONDS },
      }),
    );
    return result === null ? "duplicate" : "claimed";
  } catch (error) {
    await logDedupeUnavailable(logger, error);
    return "unavailable";
  }
};

const releaseClaim = async (logger: Request["logger"], key: string) => {
  try {
    if (!redis.isReady) throw new Error("Redis is not connected");
    await withTimeout(redis.del(key));
  } catch (error) {
    await logDedupeUnavailable(logger, error);
  }
};

export const dailyWebhookHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const timestamp = request.headers["x-webhook-timestamp"];
    const signature = request.headers["x-webhook-signature"];
    const rawBody = request.body as Buffer;

    if (
      typeof timestamp !== "string" ||
      typeof signature !== "string" ||
      !Buffer.isBuffer(rawBody) ||
      !verifyDailySignature(rawBody, timestamp, signature)
    ) {
      await request.logger.warn({
        message: "Webhook signature rejected",
        eventName: "webhook.inbound.rejected",
        attributes: {
          "webhook.source": "daily",
          "webhook.reject_reason": "invalid_signature",
        },
      });
      throw new ApiError(400, "Invalid Daily webhook signature.");
    }

    const event = JSON.parse(
      rawBody.toString("utf8"),
    ) as DailyMeetingEndedEvent;

    const eventKey =
      typeof event.id === "string" && event.id
        ? `webhook:daily:${event.id}`
        : null;

    const claim = eventKey
      ? await claimEvent(request.logger, eventKey)
      : "unavailable";

    if (claim === "duplicate") {
      response
        .status(200)
        .json({ success: true, message: "Webhook already processed." });
      return;
    }

    try {
      if (event.type === "meeting.ended" && event.payload?.room) {
        const ended = await endMeetingByRoomName(event.payload.room);
        if (ended) {
          await request.logger.info({
            message: "Meeting ended",
            eventName: "task.meeting.completed",
            attributes: {
              "task.meeting.id": ended.id,
              "task.meeting.conversation_id": ended.conversationId,
              "task.meeting.duration_minutes": ended.durationMinutes,
            },
          });
        }
      }
    } catch (error) {
      if (eventKey && claim === "claimed") {
        await releaseClaim(request.logger, eventKey);
      }
      throw error;
    }

    response.status(200).json({ success: true, message: "Webhook processed." });
  },
);
