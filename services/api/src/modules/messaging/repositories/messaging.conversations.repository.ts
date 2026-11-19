import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "@/database/database.types.js";
import { accounts } from "@/modules/auth/models/auth.model.js";
import { contracts } from "@/modules/contracts/models/contracts.model.js";
import { job_posts } from "@/modules/jobs/models/jobs.model.js";
import { meetings } from "@/modules/meetings/models/meetings.model.js";
import { proposals } from "@/modules/proposals/models/proposals.model.js";
import {
  conversation_participants,
  conversations,
  message_attachments,
  messages,
} from "@/modules/messaging/models/messaging.model.js";
import {
  insertMessages,
  type NewMessage,
} from "./messaging.messages.repository.js";
import {
  incrementUnreadCounts,
  type UnreadTarget,
} from "./messaging.participants.repository.js";

const participantFilter = (who: { agencyId: string | null; userId: string }) =>
  who.agencyId
    ? eq(conversation_participants.agency_id, who.agencyId)
    : eq(conversation_participants.account_id, who.userId);

export const sumUnreadOfParticipant = async (
  executor: DbExecutor,
  who: { agencyId: string | null; userId: string },
) => {
  const [row] = await executor
    .select({
      total:
        sql<number>`coalesce(sum(${conversation_participants.unread_count}), 0)`.mapWith(
          Number,
        ),
    })
    .from(conversation_participants)
    .where(participantFilter(who));
  return row?.total ?? 0;
};

export const listConversationRowsOfParticipant = (
  executor: DbExecutor,
  who: { agencyId: string | null; userId: string },
  options: {
    page?: { limit: number; offset: number };
    conversationId?: string;
  } = {},
) => {
  const query = executor
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
      lastMessageSenderAccountId: accounts.id,
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
    .leftJoin(accounts, eq(accounts.auth_id, messages.sender_id))
    .leftJoin(job_posts, eq(conversations.job_id, job_posts.id))
    .leftJoin(contracts, eq(conversations.proposal_id, contracts.proposal_id))
    .where(
      options.conversationId
        ? and(
            participantFilter(who),
            eq(conversations.id, options.conversationId),
          )
        : participantFilter(who),
    )
    .orderBy(
      desc(conversations.last_message_at),
      desc(conversations.created_at),
      desc(conversations.id),
    )
    .$dynamic();

  return options.page
    ? query.limit(options.page.limit).offset(options.page.offset)
    : query;
};

export const listActiveMeetingsForConversations = (
  executor: DbExecutor,
  conversationIds: string[],
) =>
  executor
    .select({
      conversationId: meetings.conversation_id,
      id: meetings.id,
      roomName: meetings.provider_room_name,
      joinUrl: meetings.join_url,
      startedAt: meetings.started_at,
      startedByAccountId: meetings.started_by_account_id,
      startedByPublicId: accounts.id,
    })
    .from(meetings)
    .leftJoin(accounts, eq(accounts.auth_id, meetings.started_by_account_id))
    .where(
      and(
        inArray(meetings.conversation_id, conversationIds),
        eq(meetings.status, "ACTIVE"),
      ),
    );

export const findActiveMeetingForConversation = async (
  executor: DbExecutor,
  conversationId: string,
) => {
  const [activeMeeting] = await executor
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.conversation_id, conversationId),
        eq(meetings.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return activeMeeting;
};

export const findProposalWithJobClient = async (
  executor: DbExecutor,
  proposalId: string,
) => {
  const [proposal] = await executor
    .select({
      freelancerId: proposals.sender_id,
      senderType: proposals.sender_type,
      jobId: proposals.job_id,
      clientId: job_posts.client_id,
    })
    .from(proposals)
    .innerJoin(job_posts, eq(proposals.job_id, job_posts.id))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  return proposal;
};

export const findAccountByPublicId = async (
  executor: DbExecutor,
  accountId: string,
) => {
  const [recipient] = await executor
    .select({ authId: accounts.auth_id, role: accounts.role })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return recipient;
};

export const findJobOwnedByClient = async (
  executor: DbExecutor,
  jobId: string,
  clientId: string,
) => {
  const [job] = await executor
    .select({ id: job_posts.id })
    .from(job_posts)
    .where(and(eq(job_posts.id, jobId), eq(job_posts.client_id, clientId)))
    .limit(1);
  return job;
};

export const insertOrFindConversationByContextKey = async (
  executor: DbExecutor,
  input: {
    jobId: string | undefined;
    proposalId: string | undefined;
    contextKey: string;
  },
) => {
  const [created] = await executor
    .insert(conversations)
    .values({
      job_id: input.jobId,
      proposal_id: input.proposalId,
      context_key: input.contextKey,
    })
    .onConflictDoNothing({ target: conversations.context_key })
    .returning({ id: conversations.id });
  if (created) return created;

  const [existing] = await executor
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.context_key, input.contextKey))
    .limit(1);
  return existing;
};

export const setConversationLastMessage = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    messageId: string;
    messageAt: Date;
    updatedAt: Date;
    proposalId?: string;
  },
) => {
  await executor
    .update(conversations)
    .set({
      ...(input.proposalId ? { proposal_id: input.proposalId } : {}),
      last_message_id: input.messageId,
      last_message_at: input.messageAt,
      updated_at: input.updatedAt,
    })
    .where(eq(conversations.id, input.conversationId));
};

export const appendConversationMessages = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    messages: NewMessage[];
    updatedAt: Date;
    unread: UnreadTarget;
  },
) => {
  const rows = await insertMessages(
    executor,
    input.conversationId,
    input.messages,
  );
  const last = rows.at(-1);
  if (!last) return rows;

  await setConversationLastMessage(executor, {
    conversationId: input.conversationId,
    messageId: last.id,
    messageAt: last.created_at,
    updatedAt: input.updatedAt,
  });
  await incrementUnreadCounts(
    executor,
    input.conversationId,
    input.unread,
    rows.length,
  );
  return rows;
};
