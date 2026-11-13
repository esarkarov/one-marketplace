import { and, eq, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  conversation_participants,
  conversations,
  messages,
} from "./messaging.schema.js";

export { emitConversationUpdate } from "./messaging.socket.js";
export { postSystemEventMessage, requireMember } from "./messaging.service.js";

type UnreadTarget =
  { account: string; agency?: string | null } | { allExceptType: "CLIENT" };

export const appendConversationMessages = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    messages: Omit<typeof messages.$inferInsert, "conversation_id">[];
    updatedAt: Date;
    unread: UnreadTarget;
  },
) => {
  const rows = await executor
    .insert(messages)
    .values(
      input.messages.map((message) => ({
        ...message,
        conversation_id: input.conversationId,
      })),
    )
    .returning();
  const last = rows.at(-1);
  if (!last) return rows;

  await executor
    .update(conversations)
    .set({
      last_message_id: last.id,
      last_message_at: last.created_at,
      updated_at: input.updatedAt,
    })
    .where(eq(conversations.id, input.conversationId));
  await executor
    .update(conversation_participants)
    .set({
      unread_count: sql`${conversation_participants.unread_count} + ${rows.length}`,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, input.conversationId),
        "account" in input.unread
          ? input.unread.agency
            ? eq(conversation_participants.agency_id, input.unread.agency)
            : eq(conversation_participants.account_id, input.unread.account)
          : ne(
              conversation_participants.participant_type,
              input.unread.allExceptType,
            ),
      ),
    );
  return rows;
};

export const openInterviewConversation = async (
  executor: DbExecutor,
  input: {
    proposalId: string;
    jobId: string;
    contextKey: string;
    clientId: string;
    senderAccountId: string;
    counterparty: { accountId: string } | { agencyId: string };
    coverLetter: string;
    openingMessage: string;
  },
) => {
  const [createdConversation] = await executor
    .insert(conversations)
    .values({
      job_id: input.jobId,
      proposal_id: input.proposalId,
      context_key: input.contextKey,
    })
    .onConflictDoNothing({ target: conversations.context_key })
    .returning({ id: conversations.id });

  const conversation =
    createdConversation ??
    (
      await executor
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.context_key, input.contextKey))
        .limit(1)
    )[0];

  if (!conversation) {
    throw new ApiError(500, "Conversation could not be created.");
  }

  await executor
    .insert(conversation_participants)
    .values([
      {
        conversation_id: conversation.id,
        account_id: input.clientId,
        participant_type: "CLIENT",
      },
      "agencyId" in input.counterparty
        ? {
            conversation_id: conversation.id,
            agency_id: input.counterparty.agencyId,
            participant_type: "AGENCY",
          }
        : {
            conversation_id: conversation.id,
            account_id: input.counterparty.accountId,
            participant_type: "FREELANCER",
          },
    ])
    .onConflictDoNothing();

  const now = new Date();

  const [proposalMessage] = await executor
    .insert(messages)
    .values({
      conversation_id: conversation.id,
      sender_id: input.senderAccountId,
      body: input.coverLetter,
      created_at: now,
    })
    .returning({ id: messages.id, createdAt: messages.created_at });
  if (!proposalMessage) {
    throw new ApiError(500, "Interview messages could not be created.");
  }

  const [clientMessage] = await executor
    .insert(messages)
    .values({
      conversation_id: conversation.id,
      sender_id: input.clientId,
      body: input.openingMessage,
      reply_to_message_id: proposalMessage.id,
      created_at: new Date(now.getTime() + 1),
    })
    .returning({ id: messages.id, createdAt: messages.created_at });

  if (!clientMessage) {
    throw new ApiError(500, "Interview messages could not be created.");
  }

  await executor
    .update(conversations)
    .set({
      proposal_id: input.proposalId,
      last_message_id: clientMessage.id,
      last_message_at: clientMessage.createdAt,
      updated_at: new Date(),
    })
    .where(eq(conversations.id, conversation.id));

  await executor
    .update(conversation_participants)
    .set({
      last_read_message_id: clientMessage.id,
      last_read_at: new Date(),
      unread_count: 0,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, conversation.id),
        eq(conversation_participants.account_id, input.clientId),
      ),
    );

  await executor
    .update(conversation_participants)
    .set({
      unread_count: sql`${conversation_participants.unread_count} + 1`,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, conversation.id),
        ne(conversation_participants.participant_type, "CLIENT"),
      ),
    );

  return { conversationId: conversation.id };
};
