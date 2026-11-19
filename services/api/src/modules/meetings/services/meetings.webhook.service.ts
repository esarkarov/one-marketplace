import { createHmac, timingSafeEqual } from "crypto";
import type { AppLogger } from "../../../config/logger.js";
import { env } from "../../../config/env.js";
import { redis } from "../../../infrastructure/cache/redis.client.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { errorLogAttributes } from "../../../shared/logging/sanitize-log.js";
import { endMeetingByRoomName } from "./meetings.service.js";

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

const logDedupeUnavailable = (logger: AppLogger, error: unknown) =>
  logger.warn({
    message: "Webhook deduplication unavailable",
    eventName: "webhook.inbound.dedupe_unavailable",
    attributes: {
      "webhook.source": "daily",
      ...errorLogAttributes(error),
    },
  });

const claimEvent = async (
  logger: AppLogger,
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

const releaseClaim = async (logger: AppLogger, key: string) => {
  try {
    if (!redis.isReady) throw new Error("Redis is not connected");
    await withTimeout(redis.del(key));
  } catch (error) {
    await logDedupeUnavailable(logger, error);
  }
};

export interface DailyWebhookInput {
  timestamp: unknown;
  signature: unknown;
  rawBody: unknown;
  logger: AppLogger;
}

export const handleDailyWebhook = async ({
  timestamp,
  signature,
  rawBody,
  logger,
}: DailyWebhookInput): Promise<"processed" | "duplicate"> => {
  if (
    typeof timestamp !== "string" ||
    typeof signature !== "string" ||
    !Buffer.isBuffer(rawBody) ||
    !verifyDailySignature(rawBody, timestamp, signature)
  ) {
    await logger.warn({
      message: "Webhook signature rejected",
      eventName: "webhook.inbound.rejected",
      attributes: {
        "webhook.source": "daily",
        "webhook.reject_reason": "invalid_signature",
      },
    });
    throw new ApiError(400, "Invalid Daily webhook signature.");
  }

  const event = JSON.parse(rawBody.toString("utf8")) as DailyMeetingEndedEvent;

  const eventKey =
    typeof event.id === "string" && event.id
      ? `webhook:daily:${event.id}`
      : null;

  const claim = eventKey ? await claimEvent(logger, eventKey) : "unavailable";

  if (claim === "duplicate") return "duplicate";

  try {
    if (event.type === "meeting.ended" && event.payload?.room) {
      const ended = await endMeetingByRoomName(event.payload.room);
      if (ended) {
        await logger.info({
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
      await releaseClaim(logger, eventKey);
    }
    throw error;
  }

  return "processed";
};
