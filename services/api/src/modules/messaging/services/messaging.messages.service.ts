import { db } from "../../../database/client.js";
import {
  findActiveMeetingForConversation,
  setConversationLastMessage,
} from "../repositories/messaging.conversations.repository.js";
import {
  countMessagesFromOthersAfter,
  findMessageInConversation,
  insertMessageAttachments,
  insertMessages,
  listAttachmentsForMessages,
  listMessagesPage,
  listReplyPreviews,
} from "../repositories/messaging.messages.repository.js";
import {
  findParticipantReadState,
  incrementUnreadCounts,
  markParticipantReadIfNotAhead,
} from "../repositories/messaging.participants.repository.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../../shared/uploads/upload-documents.js";
import { emitConversationUpdate } from "../messaging.socket.js";
import { getAgencyTeamMemberIds } from "../../agency/index.js";
import { AttachmentInput } from "../types/messaging.types.js";
import { requireMember } from "./messaging.conversations.service.js";

const encodeCursor = (message: { createdAt: Date; id: string }) =>
  Buffer.from(
    JSON.stringify([message.createdAt.toISOString(), message.id]),
  ).toString("base64url");

const decodeCursor = (cursor: string) => {
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as [string, string];
    const date = new Date(createdAt);
    if (!id || Number.isNaN(date.getTime())) throw new Error();
    return { createdAt: date, id };
  } catch {
    throw new ApiError(400, "Message cursor is invalid.");
  }
};

export const hydrateMessages = async (
  rows: Array<{
    id: string;
    conversationId: string;
    senderId: string | null;
    messageType: string;
    body: string | null;
    eventType: string | null;
    eventPayload: Record<string, unknown> | null;
    replyToMessageId: string | null;
    createdAt: Date;
  }>,
) => {
  if (!rows.length) return [];
  const attachments = await listAttachmentsForMessages(
    db,
    rows.map(({ id }) => id),
  );
  const replyIds = rows
    .map(({ replyToMessageId }) => replyToMessageId)
    .filter((id): id is string => Boolean(id));
  const replies = replyIds.length ? await listReplyPreviews(db, replyIds) : [];

  return rows.map((message) => ({
    ...message,
    attachments: attachments.filter(
      ({ message_id }) => message_id === message.id,
    ),
    replyTo: replies.find(({ id }) => id === message.replyToMessageId) ?? null,
  }));
};

export const getMessages = async (
  conversationId: string,
  userId: string,
  cursor?: string,
  limit = 30,
) => {
  await requireMember(conversationId, userId);
  const before = cursor ? decodeCursor(cursor) : null;
  const rows = await listMessagesPage(db, {
    conversationId,
    before,
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  return {
    messages: (await hydrateMessages(page)).reverse(),
    nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
  };
};

export const sendMessage = async (
  conversationId: string,
  senderId: string,
  input: {
    body?: string;
    replyToMessageId?: string;
    attachments: AttachmentInput[];
  },
) => {
  const participant = await requireMember(conversationId, senderId);

  const activeMeeting = await findActiveMeetingForConversation(
    db,
    conversationId,
  );
  if (activeMeeting) {
    throw new ApiError(423, "Chat is paused while a meeting is in progress.");
  }

  if (input.replyToMessageId) {
    const reply = await findMessageInConversation(
      db,
      input.replyToMessageId,
      conversationId,
    );
    if (!reply) throw new ApiError(400, "Reply message is invalid.");
  }

  const { documents: uploaded, uploadedIds } = await uploadDocuments(
    `/onemarketplace/messages/${conversationId}/${senderId}`,
    input.attachments,
  );
  let message;
  try {
    message = await db.transaction(async (transaction) => {
      const [created] = await insertMessages(transaction, conversationId, [
        {
          sender_id: senderId,
          body: input.body,
          reply_to_message_id: input.replyToMessageId,
        },
      ]);
      if (!created) throw new ApiError(500, "Message could not be sent.");

      if (uploaded.length) {
        await insertMessageAttachments(
          transaction,
          uploaded.map((attachment) => ({
            message_id: created.id,
            storage_key: attachment.fileId,
            file_url: attachment.fileUrl,
            file_name: attachment.fileName,
            mime_type: attachment.mimeType,
            file_size: attachment.fileSize,
            attachment_type: attachment.attachmentType,
          })),
        );
      }
      await setConversationLastMessage(transaction, {
        conversationId,
        messageId: created.id,
        messageAt: created.created_at,
        updatedAt: new Date(),
      });
      await incrementUnreadCounts(
        transaction,
        conversationId,
        { exceptParticipant: participant.id },
        1,
      );
      return created;
    });
  } catch (error) {
    await deleteDocuments(uploadedIds);
    throw error;
  }

  const hydrated = (
    await hydrateMessages([
      {
        id: message.id,
        conversationId: message.conversation_id,
        senderId: message.sender_id,
        messageType: message.message_type,
        body: message.body,
        eventType: message.event_type,
        eventPayload: message.event_payload,
        replyToMessageId: message.reply_to_message_id,
        createdAt: message.created_at,
      },
    ])
  )[0]!;
  await emitConversationUpdate(conversationId, senderId);
  return hydrated;
};

export const markConversationRead = async (
  conversationId: string,
  userId: string,
  lastReadMessageId: string,
) => {
  const participant = await requireMember(conversationId, userId);
  const message = await findMessageInConversation(
    db,
    lastReadMessageId,
    conversationId,
  );
  if (!message) throw new ApiError(400, "Read message is invalid.");

  const excludedSenderIds = participant.agency_id
    ? await getAgencyTeamMemberIds(participant.agency_id)
    : [userId];

  const remaining = await countMessagesFromOthersAfter(db, {
    conversationId,
    excludedSenderIds,
    after: message,
  });

  const updated = await markParticipantReadIfNotAhead(db, {
    participantId: participant.id,
    message,
    unreadCount: remaining?.value ?? 0,
  });
  if (updated) {
    return { conversationId, lastReadMessageId: message.id, ...updated };
  }

  const current = await findParticipantReadState(db, participant.id);
  return { conversationId, ...current };
};
