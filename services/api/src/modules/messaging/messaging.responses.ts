import { z } from "zod";
import {
  ErrorBody,
  cursorPage,
  isoDateTime,
  ok,
  BadRequestBody,
} from "../../utils/response-schemas.js";

const MessageAttachment = z
  .strictObject({
    id: z.uuid(),
    message_id: z.uuid(),
    storage_key: z.string(),
    file_url: z.string(),
    file_name: z.string(),
    mime_type: z.string(),
    file_size: z.number().int().min(0),
    attachment_type: z.string(),
    is_available: z.boolean(),
    created_at: isoDateTime,
  })
  .meta({ id: "MessagingMessageAttachment" });

const MessageReply = z
  .strictObject({
    id: z.uuid(),
    senderId: z.string().nullable(),
    messageType: z.string(),
    body: z.string().nullable(),
    eventType: z.string().nullable(),
  })
  .meta({ id: "MessagingMessageReply" });

const Message = z
  .strictObject({
    id: z.uuid(),
    conversationId: z.uuid(),
    senderId: z.string().nullable(),
    messageType: z.enum(["USER", "SYSTEM_EVENT"]),
    body: z.string().nullable(),
    eventType: z.string().nullable(),
    eventPayload: z.record(z.string(), z.unknown()).nullable(),
    replyToMessageId: z.uuid().nullable(),
    createdAt: isoDateTime,
    attachments: z.array(MessageAttachment),
    replyTo: MessageReply.nullable(),
  })
  .meta({ id: "MessagingMessage" });

const Participant = z
  .strictObject({
    participantType: z.enum(["CLIENT", "FREELANCER", "AGENCY"]),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    professionalTitle: z.string().nullable(),
    companyName: z.string().nullable(),
  })
  .meta({ id: "MessagingParticipant" });

const ActiveMeeting = z
  .strictObject({
    conversationId: z.uuid(),
    id: z.uuid(),
    joinUrl: z.string(),
    startedAt: isoDateTime,
    startedByAccountId: z.string(),
  })
  .meta({ id: "MessagingActiveMeeting" });

const Conversation = z
  .strictObject({
    id: z.uuid(),
    jobId: z.uuid().nullable(),
    proposalId: z.uuid().nullable(),
    lastMessageAt: isoDateTime.nullable(),
    updatedAt: isoDateTime,
    unreadCount: z.number().int().min(0),
    lastMessage: z
      .strictObject({
        id: z.uuid(),
        senderId: z.string().nullable(),
        messageType: z.enum(["USER", "SYSTEM_EVENT"]),
        body: z.string().nullable(),
        eventType: z.string().nullable(),
        createdAt: isoDateTime,
      })
      .nullable(),
    lastAttachmentName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    contractId: z.uuid().nullable(),
    contractStatus: z.enum(["PENDING", "ACTIVE", "COMPLETED"]).nullable(),
    participants: z.array(Participant),
    activeMeeting: ActiveMeeting.nullable(),
  })
  .meta({ id: "MessagingConversation" });

export const messagingResponses = {
  list: {
    200: ok(
      z.strictObject({
        conversations: z.array(Conversation),
        totalUnread: z.number().int().min(0),
      }),
    ),
  },
  open: {
    201: ok(Conversation),
    400: BadRequestBody,
    403: ErrorBody,
    404: ErrorBody,
  },
  send: {
    201: ok(Message),
    400: BadRequestBody,
    404: ErrorBody,
    423: ErrorBody,
  },
  messages: {
    200: ok(cursorPage("messages", Message)),
    400: BadRequestBody,
    404: ErrorBody,
  },
  read: {
    200: ok(
      z.strictObject({
        conversationId: z.uuid(),
        lastReadMessageId: z.uuid().nullable(),
        unreadCount: z.number().int().min(0),
      }),
    ),
    400: BadRequestBody,
    404: ErrorBody,
  },
};
