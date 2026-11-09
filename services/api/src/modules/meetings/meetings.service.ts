import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { meetings } from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
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
  const [active] = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.provider_room_name, roomName),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .limit(1);

  if (!active) return null;

  const endedAt = new Date();
  await db
    .update(meetings)
    .set({ status: "ENDED", ended_at: endedAt, updated_at: endedAt })
    .where(eq(meetings.id, active.id));

  const durationMinutes = Math.max(
    1,
    Math.round((endedAt.getTime() - active.started_at.getTime()) / 60000),
  );

  await postSystemEventMessage(active.conversation_id, {
    eventType: "MEETING_ENDED",
    eventPayload: {
      meetingId: active.id,
      durationMinutes,
    },
  });

  return {
    id: active.id,
    conversationId: active.conversation_id,
    durationMinutes,
  };
};
