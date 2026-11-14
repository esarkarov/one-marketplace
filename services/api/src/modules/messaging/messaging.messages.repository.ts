import {
  and,
  count,
  desc,
  eq,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { message_attachments, messages } from "./messaging.schema.js";

export type NewMessage = Omit<typeof messages.$inferInsert, "conversation_id">;

export const insertMessages = (
  executor: DbExecutor,
  conversationId: string,
  newMessages: NewMessage[],
) =>
  executor
    .insert(messages)
    .values(
      newMessages.map((message) => ({
        ...message,
        conversation_id: conversationId,
      })),
    )
    .returning();

export const insertMessageAttachments = async (
  executor: DbExecutor,
  rows: (typeof message_attachments.$inferInsert)[],
) => {
  await executor.insert(message_attachments).values(rows);
};

export const listMessagesPage = (
  executor: DbExecutor,
  input: {
    conversationId: string;
    before: { createdAt: Date; id: string } | null;
    limit: number;
  },
) =>
  executor
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
        eq(messages.conversation_id, input.conversationId),
        input.before
          ? or(
              lt(messages.created_at, input.before.createdAt),
              and(
                eq(messages.created_at, input.before.createdAt),
                lt(messages.id, input.before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.created_at), desc(messages.id))
    .limit(input.limit);

export const listAttachmentsForMessages = (
  executor: DbExecutor,
  messageIds: string[],
) =>
  executor
    .select()
    .from(message_attachments)
    .where(inArray(message_attachments.message_id, messageIds));

export const listReplyPreviews = (executor: DbExecutor, messageIds: string[]) =>
  executor
    .select({
      id: messages.id,
      senderId: messages.sender_id,
      messageType: messages.message_type,
      body: messages.body,
      eventType: messages.event_type,
    })
    .from(messages)
    .where(inArray(messages.id, messageIds));

export const findMessageInConversation = async (
  executor: DbExecutor,
  messageId: string,
  conversationId: string,
) => {
  const [message] = await executor
    .select({ id: messages.id, createdAt: messages.created_at })
    .from(messages)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.conversation_id, conversationId),
      ),
    )
    .limit(1);
  return message;
};

export const countMessagesFromOthersAfter = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    excludedSenderIds: string[];
    after: { id: string; createdAt: Date };
  },
) => {
  const [remaining] = await executor
    .select({ value: count(messages.id) })
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, input.conversationId),
        notInArray(messages.sender_id, input.excludedSenderIds),
        or(
          sql`${messages.created_at} > ${input.after.createdAt}`,
          and(
            eq(messages.created_at, input.after.createdAt),
            sql`${messages.id} > ${input.after.id}`,
          ),
        ),
      ),
    );
  return remaining;
};
