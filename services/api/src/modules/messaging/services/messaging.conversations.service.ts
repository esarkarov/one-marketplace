import { db } from "../../../database/client.js";
import {
  fetchSize,
  toOffsetPage,
} from "../../../shared/validation/utils/pagination.utils.js";
import {
  findAccountByPublicId,
  findJobOwnedByClient,
  findProposalWithJobClient,
  insertOrFindConversationByContextKey,
  listActiveMeetingsForConversations,
  listConversationRowsOfParticipant,
  sumUnreadOfParticipant,
} from "../repositories/messaging.conversations.repository.js";
import {
  findParticipantByAccount,
  findParticipantByAgency,
  insertConversationParticipantsIfAbsent,
  listParticipantProfileRows,
} from "../repositories/messaging.participants.repository.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import type { DbExecutor } from "../../../database/database.types.js";
import { findAccountDisplays } from "../../auth/index.js";
import {
  getAgencyIdForMember,
  getAgencyTeamMemberIds,
} from "../../agency/index.js";
import { ConversationScope } from "../types/messaging.types.js";
import { toConversationResponse } from "../utils/messaging.mappers.js";

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

  const displays = await findAccountDisplays(
    rows
      .map(({ accountId }) => accountId)
      .filter((accountId): accountId is string => Boolean(accountId)),
  );

  const profiles = new Map<string, unknown[]>();
  for (const row of rows) {
    const isAgency = row.participantType === "AGENCY";
    const display = row.accountId ? displays.get(row.accountId) : undefined;
    const profile = {
      participantType: row.participantType,
      name: isAgency
        ? (row.agencyName ?? "Agency")
        : display?.displayName || row.companyName || "Member",
      avatarUrl: isAgency
        ? (row.agencyAvatar?.url ?? null)
        : display?.avatarUrl || null,
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

type ConversationRow = Awaited<
  ReturnType<typeof listConversationRowsOfParticipant>
>[number];

export const getConversations = async (
  userId: string,
  scope: ConversationScope,
  { limit, offset }: { limit: number; offset: number },
) => {
  let agencyId: string | null = null;
  if (scope === "agency") {
    agencyId = await getAgencyIdForMember(userId);
    if (!agencyId) return { results: [], hasMore: false, totalUnread: 0 };
  }

  const who = { agencyId, userId };
  const [page, totalUnread] = await Promise.all([
    listConversationRowsOfParticipant(db, who, {
      page: { limit: fetchSize(limit), offset },
    }),
    sumUnreadOfParticipant(db, who),
  ]);
  const { rows, hasMore } = toOffsetPage(page, limit);

  return {
    results: await hydrateConversations(rows, "messaging_get"),
    hasMore,
    totalUnread,
  };
};

const hydrateConversations = async (
  rows: ConversationRow[],
  operation: string,
) => {
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

  return rows.map((row) =>
    toConversationResponse(
      row,
      profiles.get(row.id) ?? [],
      activeMeetingByConversation.get(row.id),
      operation,
    ),
  );
};

export const createConversation = async (
  clientId: string,
  input: { recipientId?: string; jobId?: string; proposalId?: string },
) => {
  let recipientId: string | undefined;
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
    if (!input.recipientId) throw new ApiError(400, "Recipient is required.");
    const recipient = await findAccountByPublicId(db, input.recipientId);
    if (recipient?.authId === clientId) {
      throw new ApiError(400, "You cannot start a conversation with yourself.");
    }
    if (recipient?.role !== "FREELANCER") {
      throw new ApiError(404, "Freelancer not found.");
    }
    recipientId = recipient.authId;
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

  const rows = await listConversationRowsOfParticipant(
    db,
    { agencyId: null, userId: clientId },
    { conversationId },
  );
  const [conversation] = await hydrateConversations(rows, "messaging_post");
  return conversation!;
};
