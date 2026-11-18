import { db } from "../../../database/client.js";
import type { messages } from "../models/messaging.model.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import type { DbExecutor } from "../../../database/database.types.js";
import { emitConversationUpdate } from "../messaging.socket.js";
import { appendConversationMessages } from "../repositories/messaging.conversations.repository.js";
import { SystemEventInput } from "../types/messaging.types.js";
import { requireMember } from "./messaging.conversations.service.js";
import { hydrateMessages } from "./messaging.messages.service.js";
import { findAccountIdByAuthId } from "../../auth/index.js";
import { requirePublicId } from "../../../shared/ids/public-ids.js";

const writeSystemEventMessage = async (
  executor: DbExecutor,
  conversationId: string,
  event: SystemEventInput,
  actorId: string | undefined,
  excludeParticipantId: string | undefined,
) => {
  const [created] = await appendConversationMessages(executor, {
    conversationId,
    messages: [
      {
        sender_id: actorId,
        message_type: "SYSTEM_EVENT",
        event_type: event.eventType,
        event_payload: event.eventPayload,
      },
    ],
    updatedAt: new Date(),
    unread: excludeParticipantId
      ? { exceptParticipant: excludeParticipantId }
      : { all: true },
  });
  if (!created) {
    throw new ApiError(500, "Event message could not be created.");
  }

  return created;
};

const publishSystemEventMessage = async (
  message: typeof messages.$inferSelect,
  actorId: string | undefined,
) => {
  const senderAccountId = actorId
    ? requirePublicId(
        await findAccountIdByAuthId(db, actorId),
        "messaging_system_event",
        message.id,
      )
    : null;
  const hydrated = (
    await hydrateMessages(
      [
        {
          id: message.id,
          conversationId: message.conversation_id,
          senderId: message.sender_id,
          senderAccountId,
          messageType: message.message_type,
          body: message.body,
          eventType: message.event_type,
          eventPayload: message.event_payload,
          replyToMessageId: message.reply_to_message_id,
          createdAt: message.created_at,
        },
      ],
      "messaging_system_event",
    )
  )[0]!;
  await emitConversationUpdate(message.conversation_id, actorId);
  return hydrated;
};

export function postSystemEventMessage(
  conversationId: string,
  event: SystemEventInput,
  options: { actorId?: string; executor: DbExecutor },
): Promise<{
  message: typeof messages.$inferSelect;
  emit: () => Promise<Awaited<ReturnType<typeof publishSystemEventMessage>>>;
}>;

export function postSystemEventMessage(
  conversationId: string,
  event: SystemEventInput,
  options?: { actorId?: string },
): Promise<Awaited<ReturnType<typeof publishSystemEventMessage>>>;

export async function postSystemEventMessage(
  conversationId: string,
  event: SystemEventInput,
  options: { actorId?: string; executor?: DbExecutor } = {},
) {
  const { actorId, executor } = options;

  const participant = actorId
    ? await requireMember(conversationId, actorId, executor)
    : undefined;

  if (executor) {
    const message = await writeSystemEventMessage(
      executor,
      conversationId,
      event,
      actorId,
      participant?.id,
    );
    return { message, emit: () => publishSystemEventMessage(message, actorId) };
  }

  const message = await db.transaction((transaction) =>
    writeSystemEventMessage(
      transaction,
      conversationId,
      event,
      actorId,
      participant?.id,
    ),
  );
  return publishSystemEventMessage(message, actorId);
}
