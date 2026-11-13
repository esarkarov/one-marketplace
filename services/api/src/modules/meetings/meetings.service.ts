import { randomUUID } from "crypto";
import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../database/pg-errors.js";
import {
  endActiveMeetingByRoomName,
  findActiveMeetingByConversation,
  insertActiveMeeting,
  setMeetingMessageId,
} from "./meetings.repository.js";
import { ApiError } from "../../shared/http/api-error.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import { logger } from "../../config/logger.js";
import { createDailyRoom } from "../../infrastructure/daily.js";
import {
  postSystemEventMessage,
  requireMember,
} from "../messaging/messaging.public.js";

const ACTIVE_MEETING_UNIQUE = "meetings_one_active_per_conversation_unique";

const logOrphanedRoom = async (
  roomName: string,
  conversationId: string,
  error: unknown,
) => {
  try {
    await logger.warn({
      message: "Daily room orphaned after meeting start failed",
      eventName: "task.meeting.room_orphaned",
      attributes: {
        "task.meeting.room_name": roomName,
        "task.conversation.id": conversationId,
        ...errorLogAttributes(error),
      },
    });
  } catch {}
};

export const startMeeting = async (conversationId: string, actorId: string) => {
  await requireMember(conversationId, actorId);

  const existing = await findActiveMeetingByConversation(db, conversationId);
  if (existing) {
    return {
      id: existing.id,
      joinUrl: existing.join_url,
      startedAt: existing.started_at,
    };
  }

  const roomName = `conv-${conversationId}-${randomUUID().slice(0, 8)}`;
  const room = await createDailyRoom(roomName);

  let result;
  try {
    result = await db.transaction(async (transaction) => {
      const created = await insertActiveMeeting(transaction, {
        conversationId,
        roomName: room.name,
        joinUrl: room.url,
        startedByAccountId: actorId,
      });
      if (!created) throw new ApiError(500, "Meeting could not be created.");

      const { message, emit } = await postSystemEventMessage(
        conversationId,
        {
          eventType: "MEETING_STARTED",
          eventPayload: {
            meetingId: created.id,
            joinUrl: created.join_url,
          },
        },
        { actorId, executor: transaction },
      );

      await setMeetingMessageId(transaction, created.id, message.id);

      return {
        summary: {
          id: created.id,
          joinUrl: created.join_url,
          startedAt: created.started_at,
        },
        emit,
      };
    });
  } catch (error) {
    await logOrphanedRoom(room.name, conversationId, error);
    if (!isUniqueViolation(error, ACTIVE_MEETING_UNIQUE)) throw error;

    const active = await findActiveMeetingByConversation(db, conversationId);
    if (!active) throw error;
    return {
      id: active.id,
      joinUrl: active.join_url,
      startedAt: active.started_at,
    };
  }

  try {
    await result.emit();
  } catch (error) {
    try {
      await logger.warn({
        message: "Meeting start notification could not be emitted",
        eventName: "task.meeting.emit_failed",
        attributes: {
          "task.meeting.id": result.summary.id,
          ...errorLogAttributes(error),
        },
      });
    } catch {}
  }

  return result.summary;
};

export const endMeetingByRoomName = async (roomName: string) => {
  const result = await db.transaction(async (transaction) => {
    const endedAt = new Date();
    const ended = await endActiveMeetingByRoomName(
      transaction,
      roomName,
      endedAt,
    );

    if (!ended) return null;

    const durationMinutes = Math.max(
      1,
      Math.round((endedAt.getTime() - ended.started_at.getTime()) / 60000),
    );

    const { emit } = await postSystemEventMessage(
      ended.conversation_id,
      {
        eventType: "MEETING_ENDED",
        eventPayload: { meetingId: ended.id, durationMinutes },
      },
      { executor: transaction },
    );

    return {
      summary: {
        id: ended.id,
        conversationId: ended.conversation_id,
        durationMinutes,
      },
      emit,
    };
  });

  if (!result) return null;

  try {
    await result.emit();
  } catch (error) {
    try {
      await logger.warn({
        message: "Meeting end notification could not be emitted",
        eventName: "task.meeting.emit_failed",
        attributes: {
          "task.meeting.id": result.summary.id,
          ...errorLogAttributes(error),
        },
      });
    } catch {}
  }

  return result.summary;
};
