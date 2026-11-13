import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { meetings } from "./meetings.schema.js";

export const findActiveMeetingByConversation = async (
  executor: DbExecutor,
  conversationId: string,
) => {
  const [meeting] = await executor
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.conversation_id, conversationId),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return meeting;
};

export const insertActiveMeeting = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    roomName: string;
    joinUrl: string;
    startedByAccountId: string;
  },
) => {
  const [created] = await executor
    .insert(meetings)
    .values({
      conversation_id: input.conversationId,
      provider: "daily",
      provider_room_name: input.roomName,
      join_url: input.joinUrl,
      started_by_account_id: input.startedByAccountId,
      status: "ACTIVE",
    })
    .returning();
  return created;
};

export const setMeetingMessageId = async (
  executor: DbExecutor,
  meetingId: string,
  messageId: string,
) => {
  await executor
    .update(meetings)
    .set({ message_id: messageId })
    .where(eq(meetings.id, meetingId));
};

export const endActiveMeetingByRoomName = async (
  executor: DbExecutor,
  roomName: string,
  endedAt: Date,
) => {
  const [ended] = await executor
    .update(meetings)
    .set({ status: "ENDED", ended_at: endedAt, updated_at: endedAt })
    .where(
      and(
        eq(meetings.provider_room_name, roomName),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .returning();
  return ended;
};
