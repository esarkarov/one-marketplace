import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { meetings } from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import { errorLogAttributes } from "../../utils/sanitize-log.js";
import { logger } from "../../config/logger.js";
import { createDailyRoom } from "../../config/daily.js";
import {
  postSystemEventMessage,
  requireMember,
} from "../messaging/messaging.service.js";

export const startMeeting = async (conversationId: string, actorId: string) => {
  await requireMember(conversationId, actorId);

  const [existing] = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.conversation_id, conversationId),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      joinUrl: existing.join_url,
      startedAt: existing.started_at,
    };
  }

  const roomName = `conv-${conversationId}-${randomUUID().slice(0, 8)}`;
  const room = await createDailyRoom(roomName);

  const [created] = await db
    .insert(meetings)
    .values({
      conversation_id: conversationId,
      provider: "daily",
      provider_room_name: room.name,
      join_url: room.url,
      started_by_account_id: actorId,
      status: "ACTIVE",
    })
    .returning();
  if (!created) throw new ApiError(500, "Meeting could not be created.");

  const message = await postSystemEventMessage(
    conversationId,
    {
      eventType: "MEETING_STARTED",
      eventPayload: {
        meetingId: created.id,
        joinUrl: created.join_url,
      },
    },
    { actorId },
  );

  await db
    .update(meetings)
    .set({ message_id: message.id })
    .where(eq(meetings.id, created.id));

  return {
    id: created.id,
    joinUrl: created.join_url,
    startedAt: created.started_at,
  };
};

export const endMeetingByRoomName = async (roomName: string) => {
  const result = await db.transaction(async (transaction) => {
    const endedAt = new Date();
    const [ended] = await transaction
      .update(meetings)
      .set({ status: "ENDED", ended_at: endedAt, updated_at: endedAt })
      .where(
        and(
          eq(meetings.provider_room_name, roomName),
          eq(meetings.status, "ACTIVE"),
        ),
      )
      .returning();

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
