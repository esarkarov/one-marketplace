import { db } from "../../database/client.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { DbExecutor } from "../../database/db-executor.js";
import {
  isAgencyRoleAllowed,
  type AgencyPermission,
} from "./agency.permissions.js";
import {
  deleteAgencyMember,
  findAgencyIdOfMember,
  findAgencyMemberWithOwner,
  findAgencyOwnerId,
  findMembershipOfUser,
  findOwnedAgencyId,
  listAgencyMemberFreelancerIds,
  setAgencyMemberRole,
} from "./agency.repository.js";

export const getAgencyIdForMember = async (
  freelancerId: string,
  executor: DbExecutor = db,
): Promise<string | null> => {
  const membership = await findAgencyIdOfMember(executor, freelancerId);

  return membership?.agencyId ?? null;
};

export const requireAgencyPermission = async (
  userId: string,
  permission: AgencyPermission,
  executor: DbExecutor = db,
): Promise<{ agencyId: string | null; role: string | null }> => {
  const membership = await findMembershipOfUser(executor, userId);
  const owned = await findOwnedAgencyId(executor, userId);

  const agencyId = membership?.agencyId ?? owned?.id ?? null;
  if (!agencyId) return { agencyId: null, role: null };

  const isOwner = owned?.id === agencyId;
  const role = membership?.agencyId === agencyId ? membership.role : "";
  if (!isAgencyRoleAllowed(permission, { isOwner, role })) {
    throw new ApiError(
      403,
      "Your agency role does not allow this action.",
      "AGENCY_PERMISSION_DENIED",
    );
  }
  return { agencyId, role };
};

export const getAgencyOwnerId = async (
  agencyId: string,
): Promise<string | null> => {
  const agency = await findAgencyOwnerId(db, agencyId);

  return agency?.ownerId ?? null;
};

export const getAgencyTeamMemberIds = async (
  agencyId: string,
): Promise<string[]> => {
  const [ownerId, members] = await Promise.all([
    getAgencyOwnerId(agencyId),
    listAgencyMemberFreelancerIds(db, agencyId),
  ]);

  return [
    ...new Set(
      [ownerId, ...members.map((member) => member.freelancerId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
};

export const updateAgencyMemberRole = async (
  agencyId: string,
  memberId: string,
  role: string,
) => {
  const member = await findAgencyMemberWithOwner(db, agencyId, memberId);

  if (!member) throw new ApiError(404, "Agency member not found.");
  if (member.freelancerId === member.ownerId) {
    throw new ApiError(400, "The agency owner's role cannot be changed.");
  }

  await setAgencyMemberRole(db, memberId, role);
};

export const removeAgencyMember = async (
  agencyId: string,
  memberId: string,
) => {
  const member = await findAgencyMemberWithOwner(db, agencyId, memberId);

  if (!member) throw new ApiError(404, "Agency member not found.");
  if (member.freelancerId === member.ownerId) {
    throw new ApiError(400, "The agency owner cannot be removed.");
  }

  await deleteAgencyMember(db, memberId);
};
