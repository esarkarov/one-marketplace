import type { DbExecutor } from "../../database/db-executor.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  insertOrFindConversationByContextKey,
  setConversationLastMessage,
} from "./messaging.conversations.repository.js";
import { insertMessages } from "./messaging.messages.repository.js";
import {
  incrementUnreadCounts,
  insertConversationParticipantsIfAbsent,
  resetClientReadState,
} from "./messaging.participants.repository.js";

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
  const conversation = await insertOrFindConversationByContextKey(executor, {
    jobId: input.jobId,
    proposalId: input.proposalId,
    contextKey: input.contextKey,
  });

  if (!conversation) {
    throw new ApiError(500, "Conversation could not be created.");
  }

  await insertConversationParticipantsIfAbsent(executor, {
    conversationId: conversation.id,
    clientId: input.clientId,
    counterparty: input.counterparty,
  });

  const now = new Date();

  const [proposalMessage] = await insertMessages(executor, conversation.id, [
    {
      sender_id: input.senderAccountId,
      body: input.coverLetter,
      created_at: now,
    },
  ]);
  if (!proposalMessage) {
    throw new ApiError(500, "Interview messages could not be created.");
  }

  const [clientMessage] = await insertMessages(executor, conversation.id, [
    {
      sender_id: input.clientId,
      body: input.openingMessage,
      reply_to_message_id: proposalMessage.id,
      created_at: new Date(now.getTime() + 1),
    },
  ]);

  if (!clientMessage) {
    throw new ApiError(500, "Interview messages could not be created.");
  }

  await setConversationLastMessage(executor, {
    conversationId: conversation.id,
    messageId: clientMessage.id,
    messageAt: clientMessage.created_at,
    updatedAt: new Date(),
    proposalId: input.proposalId,
  });

  await resetClientReadState(executor, {
    conversationId: conversation.id,
    clientId: input.clientId,
    lastReadMessageId: clientMessage.id,
  });

  await incrementUnreadCounts(
    executor,
    conversation.id,
    { allExceptType: "CLIENT" },
    1,
  );

  return { conversationId: conversation.id };
};
