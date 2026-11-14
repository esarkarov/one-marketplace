import { clerk } from "../../../infrastructure/auth/clerk.js";
import { env } from "../../../config/env.js";
import { db } from "../../../database/client.js";
import {
  findAccountRole,
  findJobOwnedByClient,
  findProposalWithJobClient,
  insertOrFindConversationByContextKey,
  listActiveMeetingsForConversations,
  listConversationRowsOfParticipant,
} from "../repositories/messaging.conversations.repository.js";
import {
  findParticipantByAccount,
  findParticipantByAgency,
  insertConversationParticipantsIfAbsent,
  listParticipantProfileRows,
} from "../repositories/messaging.participants.repository.js";
import { ApiError } from "../../../shared/http/api-error.js";
import type { DbExecutor } from "../../../database/database.types.js";
import {
  getAgencyIdForMember,
  getAgencyTeamMemberIds,
} from "../../agency/index.js";
import { ConversationScope } from "../types/messaging.types.js";

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
