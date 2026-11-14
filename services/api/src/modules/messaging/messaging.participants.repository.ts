import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { agency_metadata } from "../agency/agency.schema.js";
import { client_metadata } from "../client/client.schema.js";
import { freelancer_metadata } from "../freelancer/freelancer.schema.js";
import { conversation_participants, messages } from "./messaging.schema.js";

export type UnreadTarget =
  | { account: string; agency?: string | null }
  | { allExceptType: "CLIENT" }
  | { exceptParticipant: string }
  | { all: true };

const unreadTargetCondition = (target: UnreadTarget) => {
  if ("account" in target) {
    return target.agency
      ? eq(conversation_participants.agency_id, target.agency)
      : eq(conversation_participants.account_id, target.account);
  }
  if ("allExceptType" in target) {
    return ne(conversation_participants.participant_type, target.allExceptType);
  }
  if ("exceptParticipant" in target) {
    return ne(conversation_participants.id, target.exceptParticipant);
  }
  return undefined;
};

export const findParticipantByAccount = async (
  executor: DbExecutor,
  conversationId: string,
  accountId: string,
) => {
  const [participant] = await executor
    .select()
    .from(conversation_participants)
    .where(
      and(
        eq(conversation_participants.conversation_id, conversationId),
        eq(conversation_participants.account_id, accountId),
      ),
    )
    .limit(1);
  return participant;
};

export const findParticipantByAgency = async (
  executor: DbExecutor,
  conversationId: string,
  agencyId: string,
) => {
  const [participant] = await executor
    .select()
    .from(conversation_participants)
    .where(
      and(
        eq(conversation_participants.conversation_id, conversationId),
        eq(conversation_participants.agency_id, agencyId),
      ),
    )
    .limit(1);
  return participant;
};

export const listParticipantProfileRows = (
  executor: DbExecutor,
  conversationIds: string[],
) =>
  executor
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

export const listConversationIdsOfParticipant = (
  executor: DbExecutor,
  who: { agencyId: string } | { accountId: string },
) =>
  executor
    .select({ conversationId: conversation_participants.conversation_id })
    .from(conversation_participants)
    .where(
      "agencyId" in who
        ? eq(conversation_participants.agency_id, who.agencyId)
        : eq(conversation_participants.account_id, who.accountId),
    );

export const listParticipantsOfConversations = (
  executor: DbExecutor,
  conversationIds: string[],
) =>
  executor
    .select({
      accountId: conversation_participants.account_id,
      agencyId: conversation_participants.agency_id,
      participantType: conversation_participants.participant_type,
    })
    .from(conversation_participants)
    .where(inArray(conversation_participants.conversation_id, conversationIds));

export const insertConversationParticipantsIfAbsent = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    clientId: string;
    counterparty: { accountId: string } | { agencyId: string };
  },
) => {
  await executor
    .insert(conversation_participants)
    .values([
      {
        conversation_id: input.conversationId,
        account_id: input.clientId,
        participant_type: "CLIENT",
      },
      "agencyId" in input.counterparty
        ? {
            conversation_id: input.conversationId,
            agency_id: input.counterparty.agencyId,
            participant_type: "AGENCY",
          }
        : {
            conversation_id: input.conversationId,
            account_id: input.counterparty.accountId,
            participant_type: "FREELANCER",
          },
    ])
    .onConflictDoNothing();
};

export const incrementUnreadCounts = async (
  executor: DbExecutor,
  conversationId: string,
  target: UnreadTarget,
  by: number,
) => {
  await executor
    .update(conversation_participants)
    .set({
      unread_count: sql`${conversation_participants.unread_count} + ${by}`,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, conversationId),
        unreadTargetCondition(target),
      ),
    );
};

export const resetClientReadState = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    clientId: string;
    lastReadMessageId: string;
  },
) => {
  await executor
    .update(conversation_participants)
    .set({
      last_read_message_id: input.lastReadMessageId,
      last_read_at: new Date(),
      unread_count: 0,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, input.conversationId),
        eq(conversation_participants.account_id, input.clientId),
      ),
    );
};

export const markParticipantReadIfNotAhead = async (
  executor: DbExecutor,
  input: {
    participantId: string;
    message: { id: string; createdAt: Date };
    unreadCount: number;
  },
) => {
  const { message } = input;
  const [updated] = await executor
    .update(conversation_participants)
    .set({
      last_read_message_id: message.id,
      last_read_at: new Date(),
      unread_count: input.unreadCount,
    })
    .where(
      and(
        eq(conversation_participants.id, input.participantId),
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
  return updated;
};

export const findParticipantReadState = async (
  executor: DbExecutor,
  participantId: string,
) => {
  const [current] = await executor
    .select({
      lastReadMessageId: conversation_participants.last_read_message_id,
      unreadCount: conversation_participants.unread_count,
    })
    .from(conversation_participants)
    .where(eq(conversation_participants.id, participantId))
    .limit(1);
  return current;
};

export const markReadIfMessageInConversation = async (
  executor: DbExecutor,
  input: {
    conversationId: string;
    messageId: string;
    agencyId: string | null;
    userId: string;
  },
) => {
  const [participant] = await executor
    .update(conversation_participants)
    .set({
      last_read_message_id: input.messageId,
      last_read_at: new Date(),
      unread_count: 0,
    })
    .where(
      and(
        eq(conversation_participants.conversation_id, input.conversationId),
        input.agencyId
          ? eq(conversation_participants.agency_id, input.agencyId)
          : eq(conversation_participants.account_id, input.userId),
        sql`EXISTS (
                SELECT 1 FROM ${messages}
                WHERE ${messages.id} = ${input.messageId}
                  AND ${messages.conversation_id} = ${input.conversationId}
              )`,
      ),
    )
    .returning({ id: conversation_participants.id });
  return participant;
};
