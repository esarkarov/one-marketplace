import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/db-executor.js";
import { accounts } from "../auth/auth.schema.js";
import {
  agency_invitations,
  agency_members,
  agency_metadata,
} from "./agency.schema.js";

const invitationColumns = {
  id: agency_invitations.id,
  email: agency_invitations.email,
  role: agency_invitations.role,
  status: agency_invitations.status,
  createdAt: agency_invitations.created_at,
};

const pendingInvitationOfAgency = (agencyId: string, invitationId: string) =>
  and(
    eq(agency_invitations.id, invitationId),
    eq(agency_invitations.agency_id, agencyId),
    eq(agency_invitations.status, "PENDING"),
  );

export const listPendingInvitationsOfAgency = (
  executor: DbExecutor,
  agencyId: string,
) =>
  executor
    .select(invitationColumns)
    .from(agency_invitations)
    .where(
      and(
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .orderBy(desc(agency_invitations.created_at));

export const findAccountByEmail = async (
  executor: DbExecutor,
  email: string,
) => {
  const [account] = await executor
    .select({ authId: accounts.auth_id, role: accounts.role })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  return account;
};

export const findAgencyMemberByEmail = async (
  executor: DbExecutor,
  agencyId: string,
  email: string,
) => {
  const [existingMember] = await executor
    .select({ id: agency_members.id })
    .from(agency_members)
    .innerJoin(accounts, eq(accounts.auth_id, agency_members.freelancer_id))
    .where(
      and(eq(accounts.email, email), eq(agency_members.agency_id, agencyId)),
    )
    .limit(1);
  return existingMember;
};

export const findPendingInvitationByEmail = async (
  executor: DbExecutor,
  agencyId: string,
  email: string,
) => {
  const [existingInvite] = await executor
    .select({ id: agency_invitations.id })
    .from(agency_invitations)
    .where(
      and(
        eq(agency_invitations.agency_id, agencyId),
        eq(agency_invitations.email, email),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .limit(1);
  return existingInvite;
};

export const insertInvitation = async (
  executor: DbExecutor,
  values: { agencyId: string; email: string; role: string; invitedBy: string },
) => {
  const [invitation] = await executor
    .insert(agency_invitations)
    .values({
      agency_id: values.agencyId,
      email: values.email,
      role: values.role,
      invited_by: values.invitedBy,
    })
    .returning(invitationColumns);
  return invitation;
};

export const cancelInvitationIfPending = async (
  executor: DbExecutor,
  agencyId: string,
  invitationId: string,
) => {
  const [cancelled] = await executor
    .update(agency_invitations)
    .set({
      status: "CANCELLED",
      responded_at: new Date(),
      updated_at: new Date(),
    })
    .where(pendingInvitationOfAgency(agencyId, invitationId))
    .returning({ id: agency_invitations.id });
  return cancelled;
};

export const touchPendingInvitationIfCooldownElapsed = async (
  executor: DbExecutor,
  input: { agencyId: string; invitationId: string; cooldownSeconds: number },
) => {
  const [invitation] = await executor
    .update(agency_invitations)
    .set({ updated_at: sql`now()` })
    .where(
      and(
        pendingInvitationOfAgency(input.agencyId, input.invitationId),
        sql`${agency_invitations.updated_at} <= now() - make_interval(secs => ${input.cooldownSeconds})`,
      ),
    )
    .returning({ email: agency_invitations.email });
  return invitation;
};

export const findPendingInvitation = async (
  executor: DbExecutor,
  agencyId: string,
  invitationId: string,
) => {
  const [pending] = await executor
    .select({ id: agency_invitations.id })
    .from(agency_invitations)
    .where(pendingInvitationOfAgency(agencyId, invitationId))
    .limit(1);
  return pending;
};

export const setPendingInvitationRole = async (
  executor: DbExecutor,
  agencyId: string,
  invitationId: string,
  role: string,
) => {
  const [updated] = await executor
    .update(agency_invitations)
    .set({ role, updated_at: new Date() })
    .where(pendingInvitationOfAgency(agencyId, invitationId))
    .returning({ id: agency_invitations.id });
  return updated;
};

export const findAccountEmail = async (
  executor: DbExecutor,
  userId: string,
) => {
  const [account] = await executor
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.auth_id, userId))
    .limit(1);
  return account;
};

export const listPendingInvitationsForEmail = (
  executor: DbExecutor,
  email: string,
) =>
  executor
    .select({
      id: agency_invitations.id,
      agencyId: agency_invitations.agency_id,
      agencyName: agency_metadata.name,
      agencyAvatar: agency_metadata.avatar_image,
      role: agency_invitations.role,
      createdAt: agency_invitations.created_at,
    })
    .from(agency_invitations)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_invitations.agency_id),
    )
    .where(
      and(
        eq(agency_invitations.email, email),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .orderBy(desc(agency_invitations.created_at));

export const findInvitationWithAgency = async (
  executor: DbExecutor,
  invitationId: string,
) => {
  const [invitation] = await executor
    .select({
      id: agency_invitations.id,
      agencyId: agency_invitations.agency_id,
      agencyName: agency_metadata.name,
      role: agency_invitations.role,
      email: agency_invitations.email,
      status: agency_invitations.status,
    })
    .from(agency_invitations)
    .innerJoin(
      agency_metadata,
      eq(agency_metadata.id, agency_invitations.agency_id),
    )
    .where(eq(agency_invitations.id, invitationId))
    .limit(1);
  return invitation;
};

export const resolveInvitationIfPending = async (
  executor: DbExecutor,
  input: { invitationId: string; accept: boolean; now: Date },
) => {
  const [resolved] = await executor
    .update(agency_invitations)
    .set({
      status: input.accept ? "ACCEPTED" : "DECLINED",
      responded_at: input.now,
      updated_at: input.now,
    })
    .where(
      and(
        eq(agency_invitations.id, input.invitationId),
        eq(agency_invitations.status, "PENDING"),
      ),
    )
    .returning({
      agencyId: agency_invitations.agency_id,
      role: agency_invitations.role,
    });
  return resolved;
};
