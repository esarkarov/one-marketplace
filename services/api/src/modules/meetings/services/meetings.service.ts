import { randomUUID } from "crypto";
import { db } from "@/database/client.js";
import { isUniqueViolation } from "@/database/pg-errors.js";
import {
  endActiveMeetingByRoomName,
  findActiveMeetingByConversation,
  insertActiveMeeting,
  setMeetingMessageId,
} from "@/modules/meetings/repositories/meetings.repository.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import { logger } from "@/config/logger.js";
import {
  createDailyRoom,
  DailyRequestError,
} from "@/infrastructure/video/daily.client.js";
import {
  createMeetingJoinUrls,
  postSystemEventMessage,
  requireMember,
} from "@/modules/messaging/index.js";

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

const logDailyRequestFailed = async (error: DailyRequestError) => {
  try {
    await logger.warn({
      message: "Daily room request failed",
      eventName: "video.daily.request_failed",
      attributes: {
        ...(error.status === undefined
          ? {}
          : { "video.daily.status": error.status }),
        "video.daily.timed_out": error.timedOut,
      },
    });
  } catch {}
};

interface MeetingRow {
  id: string;
  provider_room_name: string;
  join_url: string;
  started_at: Date;
}

const toJoinSummary = async (meeting: MeetingRow, actorId: string) => {
  const urls = await createMeetingJoinUrls(
    actorId,
    [
      {
        id: meeting.id,
        roomName: meeting.provider_room_name,
        roomUrl: meeting.join_url,
        startedAt: meeting.started_at,
      },
    ],
    "meetings_start",
  );
  return {
    id: meeting.id,
    joinUrl: urls.get(meeting.id) ?? meeting.join_url,
    startedAt: meeting.started_at,
  };
};

export const startMeeting = async (conversationId: string, actorId: string) => {
  await requireMember(conversationId, actorId);

  const existing = await findActiveMeetingByConversation(db, conversationId);
  if (existing) return toJoinSummary(existing, actorId);

  const roomName = `conv-${conversationId}-${randomUUID().slice(0, 8)}`;
  let room;
  try {
    room = await createDailyRoom(roomName);
  } catch (error) {
    if (!(error instanceof DailyRequestError)) throw error;
    await logDailyRequestFailed(error);
    throw new ApiError(502, "Video room could not be created.");
  }

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
        created,
        emit,
      };
    });
  } catch (error) {
    await logOrphanedRoom(room.name, conversationId, error);
    if (!isUniqueViolation(error, ACTIVE_MEETING_UNIQUE)) throw error;

    const active = await findActiveMeetingByConversation(db, conversationId);
    if (!active) throw error;
    return toJoinSummary(active, actorId);
  }

  try {
    await result.emit();
  } catch (error) {
    try {
      await logger.warn({
        message: "Meeting start notification could not be emitted",
        eventName: "task.meeting.emit_failed",
        attributes: {
          "task.meeting.id": result.created.id,
          ...errorLogAttributes(error),
        },
      });
    } catch {}
  }

  return toJoinSummary(result.created, actorId);
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
