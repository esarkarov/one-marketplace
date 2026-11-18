import { requirePublicId } from "../../../shared/ids/public-ids.js";

interface MessageAttachmentRow {
  id: string;
  message_id: string;
  storage_key: string;
  file_url: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  attachment_type: string;
  is_available: boolean;
  created_at: Date;
}

export const toMessageAttachmentResponse = (
  attachment: MessageAttachmentRow,
) => ({
  id: attachment.id,
  messageId: attachment.message_id,
  storageKey: attachment.storage_key,
  fileUrl: attachment.file_url,
  fileName: attachment.file_name,
  mimeType: attachment.mime_type,
  fileSize: attachment.file_size,
  attachmentType: attachment.attachment_type,
  isAvailable: attachment.is_available,
  createdAt: attachment.created_at,
});

export const toPublicSenderId = (
  sender: { senderId: string | null; senderAccountId: string | null },
  operation: string,
  rowId: string,
) =>
  sender.senderId
    ? requirePublicId(sender.senderAccountId, operation, rowId)
    : null;

interface MessageSender {
  senderId: string | null;
  senderAccountId: string | null;
}

interface MessageRow extends MessageSender {
  id: string;
  conversationId: string;
  messageType: string;
  body: string | null;
  eventType: string | null;
  eventPayload: Record<string, unknown> | null;
  replyToMessageId: string | null;
  createdAt: Date;
}

interface ReplyPreviewRow extends MessageSender {
  id: string;
  messageType: string;
  body: string | null;
  eventType: string | null;
}

export const toMessageResponse = (
  message: MessageRow,
  attachments: ReturnType<typeof toMessageAttachmentResponse>[],
  reply: ReplyPreviewRow | undefined,
  operation: string,
) => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: toPublicSenderId(message, operation, message.id),
  messageType: message.messageType,
  body: message.body,
  eventType: message.eventType,
  eventPayload: message.eventPayload,
  replyToMessageId: message.replyToMessageId,
  createdAt: message.createdAt,
  attachments,
  replyTo: reply
    ? {
        id: reply.id,
        senderId: toPublicSenderId(reply, operation, reply.id),
        messageType: reply.messageType,
        body: reply.body,
        eventType: reply.eventType,
      }
    : null,
});

interface ConversationRow {
  id: string;
  jobId: string | null;
  proposalId: string | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
  unreadCount: number;
  lastMessageSenderAccountId: string | null;
  lastMessage: {
    senderId: string | null;
    id: string;
    messageType: string;
    body: string | null;
    eventType: string | null;
    createdAt: Date;
  } | null;
  lastAttachmentName: string | null;
  jobTitle: string | null;
  contractId: string | null;
  contractStatus: string | null;
}

interface ActiveMeetingRow {
  conversationId: string;
  id: string;
  joinUrl: string;
  startedAt: Date;
  startedByPublicId: string | null;
}

export const toConversationResponse = <P>(
  row: ConversationRow,
  participants: P[],
  activeMeeting: ActiveMeetingRow | undefined,
  operation: string,
) => ({
  id: row.id,
  jobId: row.jobId,
  proposalId: row.proposalId,
  lastMessageAt: row.lastMessageAt,
  updatedAt: row.updatedAt,
  unreadCount: row.unreadCount,
  lastMessage: row.lastMessage
    ? {
        id: row.lastMessage.id,
        senderId: toPublicSenderId(
          {
            senderId: row.lastMessage.senderId,
            senderAccountId: row.lastMessageSenderAccountId,
          },
          operation,
          row.id,
        ),
        messageType: row.lastMessage.messageType,
        body: row.lastMessage.body,
        eventType: row.lastMessage.eventType,
        createdAt: row.lastMessage.createdAt,
      }
    : null,
  lastAttachmentName: row.lastAttachmentName,
  jobTitle: row.jobTitle,
  contractId: row.contractId,
  contractStatus: row.contractStatus,
  participants,
  activeMeeting: activeMeeting
    ? {
        conversationId: activeMeeting.conversationId,
        id: activeMeeting.id,
        joinUrl: activeMeeting.joinUrl,
        startedAt: activeMeeting.startedAt,
        startedByAccountId: requirePublicId(
          activeMeeting.startedByPublicId,
          operation,
          activeMeeting.id,
        ),
      }
    : null,
});
