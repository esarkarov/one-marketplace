import { clerk } from "../../infrastructure/clerk.js";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import {
  findAccountRole,
  findActiveMeetingForConversation,
  findJobOwnedByClient,
  findProposalWithJobClient,
  insertOrFindConversationByContextKey,
  listActiveMeetingsForConversations,
  listConversationRowsOfParticipant,
  setConversationLastMessage,
} from "./messaging.conversations.repository.js";
import {
  countMessagesFromOthersAfter,
  findMessageInConversation,
  insertMessageAttachments,
  insertMessages,
  listAttachmentsForMessages,
  listMessagesPage,
  listReplyPreviews,
} from "./messaging.messages.repository.js";
import {
  findParticipantByAccount,
  findParticipantByAgency,
  findParticipantReadState,
  incrementUnreadCounts,
  insertConversationParticipantsIfAbsent,
  listParticipantProfileRows,
  markParticipantReadIfNotAhead,
} from "./messaging.participants.repository.js";
import type { messages } from "./messaging.schema.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { DbExecutor } from "../../database/db-executor.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../infrastructure/upload-documents.js";
import { emitConversationUpdate } from "./messaging.socket.js";
import { appendConversationMessages } from "./messaging.conversations.repository.js";
import {
  getAgencyIdForMember,
  getAgencyTeamMemberIds,
} from "../agency/agency.public.js";

export interface AttachmentInput {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
}

export const requireMember = async (
  conversationId: string,
  userId: string,
  executor: DbExecutor = db,
) => {
  const direct = await findParticipantByAccount(
    executor,
    conversationId,
    userId,
  );
  if (direct) return direct;

  const agencyId = await getAgencyIdForMember(userId, executor);
  if (agencyId) {
    const viaAgency = await findParticipantByAgency(
      executor,
      conversationId,
      agencyId,
    );
    if (viaAgency) return viaAgency;
  }

  throw new ApiError(404, "Conversation not found.");
};

const getParticipantProfiles = async (conversationIds: string[]) => {
  if (!conversationIds.length) return new Map<string, unknown[]>();

  const rows = await listParticipantProfileRows(db, conversationIds);

  const clerkUsers = new Map<
    string,
    { name: string | null; avatarUrl: string | null }
  >();
  if (env.clerkSecretKey) {
    const accountIds = [
      ...new Set(
        rows
          .map(({ accountId }) => accountId)
          .filter((accountId): accountId is string => Boolean(accountId)),
      ),
    ];
    await Promise.all(
      accountIds.map(async (accountId) => {
        try {
          const user = await clerk.users.getUser(accountId);
          clerkUsers.set(accountId, {
            name:
              [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
            avatarUrl: user.imageUrl || null,
          });
        } catch {
          clerkUsers.set(accountId, { name: null, avatarUrl: null });
        }
      }),
    );
  }

  const profiles = new Map<string, unknown[]>();
  for (const row of rows) {
    const isAgency = row.participantType === "AGENCY";
    const clerkUser = row.accountId ? clerkUsers.get(row.accountId) : undefined;
    const profile = {
      participantType: row.participantType,
      name: isAgency
        ? (row.agencyName ?? "Agency")
        : (clerkUser?.name ?? row.companyName ?? "Member"),
      avatarUrl: isAgency
        ? (row.agencyAvatar?.url ?? null)
        : (clerkUser?.avatarUrl ?? null),
      professionalTitle: row.professionalTitle ?? null,
      companyName: row.companyName ?? null,
    };
    profiles.set(row.conversationId, [
      ...(profiles.get(row.conversationId) ?? []),
      profile,
    ]);
  }
  return profiles;
};

export type ConversationScope = "default" | "agency";

export const getConversations = async (
  userId: string,
  scope: ConversationScope = "default",
) => {
  let agencyId: string | null = null;
  if (scope === "agency") {
    agencyId = await getAgencyIdForMember(userId);
    if (!agencyId) return { conversations: [], totalUnread: 0 };
  }

  const rows = await listConversationRowsOfParticipant(db, {
    agencyId,
    userId,
  });

  const profiles = await getParticipantProfiles(rows.map(({ id }) => id));
  const activeMeetings = rows.length
    ? await listActiveMeetingsForConversations(
        db,
        rows.map(({ id }) => id),
      )
    : [];
  const activeMeetingByConversation = new Map(
    activeMeetings.map((meeting) => [meeting.conversationId, meeting]),
  );

  return {
    conversations: rows.map((row) => ({
      ...row,
      participants: profiles.get(row.id) ?? [],
      activeMeeting: activeMeetingByConversation.get(row.id) ?? null,
    })),
    totalUnread: rows.reduce((total, row) => total + row.unreadCount, 0),
  };
};

export const createConversation = async (
  clientId: string,
  input: { recipientId?: string; jobId?: string; proposalId?: string },
) => {
  let recipientId = input.recipientId;
  let jobId = input.jobId;
  let isAgencyConversation = false;
  let agencyIdForKey: string | undefined;

  if (input.proposalId) {
    const proposal = await findProposalWithJobClient(db, input.proposalId);
    if (!proposal || proposal.clientId !== clientId) {
      throw new ApiError(404, "Proposal not found.");
    }

    if (proposal.senderType === "AGENCY") {
      if (
        (await getAgencyTeamMemberIds(proposal.freelancerId)).includes(clientId)
      ) {
        throw new ApiError(
          400,
          "You cannot start a conversation with yourself.",
        );
      }
      isAgencyConversation = true;
      agencyIdForKey = proposal.freelancerId;
    } else {
      if (proposal.freelancerId === clientId) {
        throw new ApiError(
          400,
          "You cannot start a conversation with yourself.",
        );
      }
      recipientId = proposal.freelancerId;
    }
    jobId = proposal.jobId;
  } else {
    if (!recipientId) throw new ApiError(400, "Recipient is required.");
    if (recipientId === clientId) {
      throw new ApiError(400, "You cannot start a conversation with yourself.");
    }
    const recipient = await findAccountRole(db, recipientId);
    if (recipient?.role !== "FREELANCER") {
      throw new ApiError(404, "Freelancer not found.");
    }
    if (jobId) {
      const job = await findJobOwnedByClient(db, jobId, clientId);
      if (!job) throw new ApiError(404, "Job post not found.");
    }
  }

  const contextKey = isAgencyConversation
    ? `job:${jobId}:client:${clientId}:agency:${agencyIdForKey}`
    : jobId
      ? `job:${jobId}:client:${clientId}:talent:${recipientId}`
      : `direct:client:${clientId}:talent:${recipientId}`;

  const conversationId = await db.transaction(async (transaction) => {
    const existing = await insertOrFindConversationByContextKey(transaction, {
      jobId,
      proposalId: input.proposalId,
      contextKey,
    });
    if (!existing)
      throw new ApiError(500, "Conversation could not be created.");

    await insertConversationParticipantsIfAbsent(transaction, {
      conversationId: existing.id,
      clientId,
      counterparty: isAgencyConversation
        ? { agencyId: agencyIdForKey! }
        : { accountId: recipientId! },
    });
    return existing.id;
  });

  const data = await getConversations(clientId);
  return data.conversations.find(({ id }) => id === conversationId)!;
};

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

const hydrateMessages = async (
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

interface SystemEventInput {
  eventType: string;
  eventPayload: Record<string, unknown>;
}

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
