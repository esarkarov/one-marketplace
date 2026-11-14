import { clerk } from "../../infrastructure/clerk.js";
import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../database/pg-errors.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { DbExecutor } from "../../database/db-executor.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { errorLogAttributes } from "../../shared/logging/sanitize-log.js";
import { sendNotification } from "../../infrastructure/events/publisher.js";
import {
  AGENCY_MEMBER_UNIQUE,
  alreadyInAgencyError,
  ALREADY_IN_AGENCY_MESSAGE,
  invitationHandledError,
} from "./agency.errors.js";
import {
  getAgencyIdForMember,
  getAgencyOwnerId,
} from "./agency.membership.service.js";
import {
  cancelInvitationIfPending,
  findAccountByEmail,
  findAccountEmail,
  findAgencyMemberByEmail,
  findInvitationWithAgency,
  findPendingInvitation,
  findPendingInvitationByEmail,
  insertInvitation,
  listPendingInvitationsForEmail,
  listPendingInvitationsOfAgency,
  resolveInvitationIfPending,
  setPendingInvitationRole,
  touchPendingInvitationIfCooldownElapsed,
} from "./agency.invitations.repository.js";
import { insertAgencyMember } from "./agency.repository.js";

export interface AgencyInvitationData {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  avatarUrl: string | null;
}

export const getAgencyInvitations = async (
  agencyId: string,
): Promise<AgencyInvitationData[]> => {
  const rows = await listPendingInvitationsOfAgency(db, agencyId);

  return rows.map((row) => ({ ...row, avatarUrl: null }));
};

const INVITATION_RESEND_COOLDOWN_SECONDS = 60;

const notifyInvitee = async (
  email: string,
  agencyId: string,
  agencyName: string,
) => {
  const account = await findAccountByEmail(db, email);

  if (!account || account.role !== "FREELANCER") return;
  if (await getAgencyIdForMember(account.authId)) return;

  try {
    await sendNotification({
      recipientId: account.authId,
      type: "AGENCY_INVITATION",
      title: "You've been invited to join an agency",
      message: `${agencyName} invited you to join their agency team.`,
      link: "/agency-invitations",
      metadata: { agencyId },
    });
  } catch (error) {
    await logger
      .warn({
        message: "Agency invitation notification failed",
        eventName: "task.agency.invitation_notify_failed",
        attributes: errorLogAttributes(error),
      })
      .catch(() => {});
  }
};

export const inviteAgencyMember = async (
  agencyId: string,
  agencyName: string,
  invitedBy: string,
  input: { email: string; role: string },
): Promise<AgencyInvitationData> => {
  const email = input.email.trim().toLowerCase();

  const existingMember = await findAgencyMemberByEmail(db, agencyId, email);
  if (existingMember) {
    throw new ApiError(
      409,
      "This person is already part of your agency team.",
      "INVITEE_ALREADY_MEMBER",
    );
  }

  const existingInvite = await findPendingInvitationByEmail(
    db,
    agencyId,
    email,
  );
  if (existingInvite) {
    throw new ApiError(
      409,
      "An invitation is already pending for this email.",
      "INVITATION_ALREADY_PENDING",
    );
  }

  const invitation = await insertInvitation(db, {
    agencyId,
    email,
    role: input.role,
    invitedBy,
  });

  if (!invitation) throw new ApiError(500, "The invitation could not be sent.");

  await notifyInvitee(email, agencyId, agencyName);

  return { ...invitation, avatarUrl: null };
};

export const cancelAgencyInvitation = async (
  agencyId: string,
  invitationId: string,
) => {
  const cancelled = await cancelInvitationIfPending(db, agencyId, invitationId);

  if (!cancelled) throw new ApiError(404, "Invitation not found.");
};

export const resendAgencyInvitation = async (
  agencyId: string,
  invitationId: string,
  agencyName: string,
) => {
  const invitation = await touchPendingInvitationIfCooldownElapsed(db, {
    agencyId,
    invitationId,
    cooldownSeconds: INVITATION_RESEND_COOLDOWN_SECONDS,
  });

  if (!invitation) {
    const pending = await findPendingInvitation(db, agencyId, invitationId);
    if (!pending) throw new ApiError(404, "Invitation not found.");
    throw new ApiError(
      429,
      `Please wait ${INVITATION_RESEND_COOLDOWN_SECONDS} seconds before resending this invitation.`,
      "INVITATION_RESEND_COOLDOWN",
    );
  }

  await notifyInvitee(invitation.email, agencyId, agencyName);
};

export const updateAgencyInvitationRole = async (
  agencyId: string,
  invitationId: string,
  role: string,
) => {
  const updated = await setPendingInvitationRole(
    db,
    agencyId,
    invitationId,
    role,
  );

  if (!updated) throw new ApiError(404, "Invitation not found.");
};

export interface MyAgencyInvitation {
  id: string;
  agencyId: string;
  agencyName: string;
  agencyAvatar: { imageId: string; url: string } | null;
  role: string;
  createdAt: Date;
}

export const getMyAgencyInvitations = async (
  userId: string,
): Promise<MyAgencyInvitation[]> => {
  const account = await findAccountEmail(db, userId);
  if (!account) return [];

  return listPendingInvitationsForEmail(db, account.email);
};

export const respondToAgencyInvitation = async (
  invitationId: string,
  userId: string,
  accept: boolean,
) => {
  const account = await findAccountEmail(db, userId);
  if (!account) throw new ApiError(404, "Account not found.");

  const invitation = await findInvitationWithAgency(db, invitationId);

  if (!invitation || invitation.email !== account.email) {
    throw new ApiError(404, "Invitation not found.");
  }

  const now = new Date();

  const resolveInvitation = (executor: DbExecutor) =>
    resolveInvitationIfPending(executor, { invitationId, accept, now });

  if (accept) {
    try {
      await db.transaction(async (transaction) => {
        const resolved = await resolveInvitation(transaction);
        if (!resolved) throw invitationHandledError();

        await insertAgencyMember(transaction, {
          agencyId: resolved.agencyId,
          freelancerId: userId,
          role: resolved.role,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, AGENCY_MEMBER_UNIQUE)) {
        throw alreadyInAgencyError(ALREADY_IN_AGENCY_MESSAGE);
      }
      throw error;
    }
  } else {
    const resolved = await resolveInvitation(db);
    if (!resolved) throw invitationHandledError();
  }

  const ownerId = await getAgencyOwnerId(invitation.agencyId);
  if (ownerId) {
    let responderName = account.email;
    if (env.clerkSecretKey) {
      try {
        const user = await clerk.users.getUser(userId);
        responderName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          account.email;
      } catch {
        // Clerk lookup is best-effort — fall back to the email already on hand.
      }
    }

    await sendNotification({
      agencyId: invitation.agencyId,
      type: accept
        ? "AGENCY_INVITATION_ACCEPTED"
        : "AGENCY_INVITATION_DECLINED",
      title: accept ? "Invitation accepted" : "Invitation declined",
      message: accept
        ? `${responderName} accepted your invitation to join ${invitation.agencyName}.`
        : `${responderName} declined your invitation to join ${invitation.agencyName}.`,
      link: "/team",
      metadata: { invitationId },
    });
  }

  return { accepted: accept };
};
