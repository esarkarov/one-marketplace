import { clerk } from "../../config/clerk.js";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import {
  accounts,
  agency_metadata,
  client_metadata,
  conversation_participants,
  conversations,
  contracts,
  freelancer_metadata,
  job_posts,
  meetings,
  message_attachments,
  messages,
  proposals,
} from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";
import type { DbExecutor } from "../../utils/db-executor.js";
import {
  deleteDocuments,
  uploadDocuments,
} from "../../utils/upload-documents.js";
import { emitConversationUpdate } from "./messaging.socket.js";
import {
  getAgencyIdForMember,
  getAgencyTeamMemberIds,
} from "../agency/agency.service.js";

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
  const [direct] = await executor
    .select()
    .from(conversation_participants)
    .where(
      and(
        eq(conversation_participants.conversation_id, conversationId),
        eq(conversation_participants.account_id, userId),
      ),
    )
    .limit(1);
  if (direct) return direct;

  const agencyId = await getAgencyIdForMember(userId, executor);
  if (agencyId) {
    const [viaAgency] = await executor
      .select()
      .from(conversation_participants)
      .where(
        and(
          eq(conversation_participants.conversation_id, conversationId),
          eq(conversation_participants.agency_id, agencyId),
        ),
      )
      .limit(1);
    if (viaAgency) return viaAgency;
  }

  throw new ApiError(404, "Conversation not found.");
};

const getParticipantProfiles = async (conversationIds: string[]) => {
  if (!conversationIds.length) return new Map<string, unknown[]>();

  const rows = await db
    .select({
      conversationId: conversation_participants.conversation_id,
      accountId: conversation_participants.account_id,
      agencyId: conversation_participants.agency_id,
      participantType: conversation_participants.participant_type,
      professionalTitle: freelancer_metadata.professional_title,
      companyName: client_metadata.company_name,
      agencyName: agency_metadata.name,
      agencyAvatar: agency_metadata.avatar_image,
    })
    .from(conversation_participants)
    .leftJoin(
      freelancer_metadata,
      eq(conversation_participants.account_id, freelancer_metadata.auth_id),
    )
    .leftJoin(
      client_metadata,
      eq(conversation_participants.account_id, client_metadata.auth_id),
    )
    .leftJoin(
      agency_metadata,
      eq(conversation_participants.agency_id, agency_metadata.id),
    )
    .where(inArray(conversation_participants.conversation_id, conversationIds));

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

  const rows = await db
    .select({
      id: conversations.id,
      jobId: conversations.job_id,
      proposalId: conversations.proposal_id,
      lastMessageAt: conversations.last_message_at,
      updatedAt: conversations.updated_at,
      unreadCount: conversation_participants.unread_count,
      lastMessage: {
        id: messages.id,
        senderId: messages.sender_id,
        messageType: messages.message_type,
        body: messages.body,
        eventType: messages.event_type,
        createdAt: messages.created_at,
      },
      lastAttachmentName: sql<string | null>`(
        SELECT ${message_attachments.file_name}
        FROM ${message_attachments}
        WHERE ${message_attachments.message_id} = ${messages.id}
        LIMIT 1
      )`,
      jobTitle: job_posts.title,
      contractId: contracts.id,
      contractStatus: contracts.status,
    })
    .from(conversation_participants)
    .innerJoin(
      conversations,
      eq(conversation_participants.conversation_id, conversations.id),
    )
    .leftJoin(messages, eq(conversations.last_message_id, messages.id))
    .leftJoin(job_posts, eq(conversations.job_id, job_posts.id))
    .leftJoin(contracts, eq(conversations.proposal_id, contracts.proposal_id))
    .where(
      agencyId
        ? eq(conversation_participants.agency_id, agencyId)
        : eq(conversation_participants.account_id, userId),
    )
    .orderBy(
      desc(conversations.last_message_at),
      desc(conversations.created_at),
    );

  const profiles = await getParticipantProfiles(rows.map(({ id }) => id));
  const activeMeetings = rows.length
    ? await db
        .select({
          conversationId: meetings.conversation_id,
          id: meetings.id,
          joinUrl: meetings.join_url,
          startedAt: meetings.started_at,
          startedByAccountId: meetings.started_by_account_id,
        })
        .from(meetings)
        .where(
          and(
            inArray(
              meetings.conversation_id,
              rows.map(({ id }) => id),
            ),
            eq(meetings.status, "ACTIVE"),
          ),
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
    const [proposal] = await db
      .select({
        freelancerId: proposals.sender_id,
        senderType: proposals.sender_type,
        jobId: proposals.job_id,
        clientId: job_posts.client_id,
      })
      .from(proposals)
      .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
      .where(eq(proposals.id, input.proposalId))
      .limit(1);
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
    const [recipient] = await db
      .select({ role: accounts.role })
      .from(accounts)
      .where(eq(accounts.auth_id, recipientId))
      .limit(1);
    if (recipient?.role !== "FREELANCER") {
      throw new ApiError(404, "Freelancer not found.");
    }
    if (jobId) {
      const [job] = await db
        .select({ id: job_posts.id })
        .from(job_posts)
        .where(and(eq(job_posts.id, jobId), eq(job_posts.client_id, clientId)))
        .limit(1);
      if (!job) throw new ApiError(404, "Job post not found.");
    }
  }

  const contextKey = isAgencyConversation
    ? `job:${jobId}:client:${clientId}:agency:${agencyIdForKey}`
    : jobId
      ? `job:${jobId}:client:${clientId}:talent:${recipientId}`
      : `direct:client:${clientId}:talent:${recipientId}`;

  const conversationId = await db.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(conversations)
      .values({
        job_id: jobId,
        proposal_id: input.proposalId,
        context_key: contextKey,
      })
      .onConflictDoNothing({ target: conversations.context_key })
      .returning({ id: conversations.id });

    const existing =
      created ??
      (
        await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.context_key, contextKey))
          .limit(1)
      )[0];
    if (!existing)
      throw new ApiError(500, "Conversation could not be created.");

    await transaction
      .insert(conversation_participants)
      .values([
        {
          conversation_id: existing.id,
          account_id: clientId,
          participant_type: "CLIENT",
        },
        isAgencyConversation
          ? {
              conversation_id: existing.id,
              agency_id: agencyIdForKey!,
              participant_type: "AGENCY",
            }
          : {
              conversation_id: existing.id,
              account_id: recipientId!,
              participant_type: "FREELANCER",
            },
      ])
      .onConflictDoNothing();
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
  const attachments = await db
    .select()
    .from(message_attachments)
    .where(
      inArray(
        message_attachments.message_id,
        rows.map(({ id }) => id),
      ),
    );
  const replyIds = rows
    .map(({ replyToMessageId }) => replyToMessageId)
    .filter((id): id is string => Boolean(id));
  const replies = replyIds.length
    ? await db
        .select({
          id: messages.id,
          senderId: messages.sender_id,
          messageType: messages.message_type,
          body: messages.body,
          eventType: messages.event_type,
        })
        .from(messages)
        .where(inArray(messages.id, replyIds))
    : [];

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
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversation_id,
      senderId: messages.sender_id,
      messageType: messages.message_type,
      body: messages.body,
      eventType: messages.event_type,
      eventPayload: messages.event_payload,
      replyToMessageId: messages.reply_to_message_id,
      createdAt: messages.created_at,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        before
          ? or(
              lt(messages.created_at, before.createdAt),
              and(
                eq(messages.created_at, before.createdAt),
                lt(messages.id, before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.created_at), desc(messages.id))
    .limit(limit + 1);

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

  const [activeMeeting] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.conversation_id, conversationId),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (activeMeeting) {
    throw new ApiError(423, "Chat is paused while a meeting is in progress.");
  }

  if (input.replyToMessageId) {
    const [reply] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.id, input.replyToMessageId),
          eq(messages.conversation_id, conversationId),
        ),
      )
      .limit(1);
    if (!reply) throw new ApiError(400, "Reply message is invalid.");
  }

  const { documents: uploaded, uploadedIds } = await uploadDocuments(
    `/onemarketplace/messages/${conversationId}/${senderId}`,
    input.attachments,
  );
  let message;
  try {
    message = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(messages)
        .values({
          conversation_id: conversationId,
          sender_id: senderId,
          body: input.body,
          reply_to_message_id: input.replyToMessageId,
        })
        .returning();
      if (!created) throw new ApiError(500, "Message could not be sent.");

      if (uploaded.length) {
        await transaction.insert(message_attachments).values(
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
      await transaction
        .update(conversations)
        .set({
          last_message_id: created.id,
          last_message_at: created.created_at,
          updated_at: new Date(),
        })
        .where(eq(conversations.id, conversationId));
      await transaction
        .update(conversation_participants)
        .set({
          unread_count: sql`${conversation_participants.unread_count} + 1`,
        })
        .where(
          and(
            eq(conversation_participants.conversation_id, conversationId),
            ne(conversation_participants.id, participant.id),
          ),
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
  const [created] = await executor
    .insert(messages)
    .values({
      conversation_id: conversationId,
      sender_id: actorId,
      message_type: "SYSTEM_EVENT",
      event_type: event.eventType,
      event_payload: event.eventPayload,
    })
    .returning();
  if (!created) {
    throw new ApiError(500, "Event message could not be created.");
  }

  await executor
    .update(conversations)
    .set({
      last_message_id: created.id,
      last_message_at: created.created_at,
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  await executor
    .update(conversation_participants)
    .set({
      unread_count: sql`${conversation_participants.unread_count} + 1`,
    })
    .where(
      excludeParticipantId
        ? and(
            eq(conversation_participants.conversation_id, conversationId),
            ne(conversation_participants.id, excludeParticipantId),
          )
        : eq(conversation_participants.conversation_id, conversationId),
    );

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
  const [message] = await db
    .select({ id: messages.id, createdAt: messages.created_at })
    .from(messages)
    .where(
      and(
        eq(messages.id, lastReadMessageId),
        eq(messages.conversation_id, conversationId),
      ),
    )
    .limit(1);
  if (!message) throw new ApiError(400, "Read message is invalid.");

  const excludedSenderIds = participant.agency_id
    ? await getAgencyTeamMemberIds(participant.agency_id)
    : [userId];

  const [remaining] = await db
    .select({ value: count(messages.id) })
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        notInArray(messages.sender_id, excludedSenderIds),
        or(
          sql`${messages.created_at} > ${message.createdAt}`,
          and(
            eq(messages.created_at, message.createdAt),
            sql`${messages.id} > ${message.id}`,
          ),
        ),
      ),
    );

  const [updated] = await db
    .update(conversation_participants)
    .set({
      last_read_message_id: message.id,
      last_read_at: new Date(),
      unread_count: remaining?.value ?? 0,
    })
    .where(
      and(
        eq(conversation_participants.id, participant.id),
        sql`(
          ${conversation_participants.last_read_message_id} IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM ${messages} AS current_read_message
            WHERE current_read_message.id = ${conversation_participants.last_read_message_id}
              AND (
                current_read_message.created_at > ${message.createdAt}
                OR (
                  current_read_message.created_at = ${message.createdAt}
                  AND current_read_message.id >= ${message.id}
                )
              )
          )
        )`,
      ),
    )
    .returning({ unreadCount: conversation_participants.unread_count });
  if (updated) {
    return { conversationId, lastReadMessageId: message.id, ...updated };
  }

  const [current] = await db
    .select({
      lastReadMessageId: conversation_participants.last_read_message_id,
      unreadCount: conversation_participants.unread_count,
    })
    .from(conversation_participants)
    .where(eq(conversation_participants.id, participant.id))
    .limit(1);
  return { conversationId, ...current };
};
