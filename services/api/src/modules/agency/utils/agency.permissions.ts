const OWNER_ENTRY = "owner";
const BUSINESS_MANAGER_ROLE = "Business manager";

export const AGENCY_PERMISSIONS = {
  "proposal.send": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
  "connects.checkout": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
  "contract.accept": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
  "contract.finish": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
  "earnings.view": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
  "team.invitations.view": [OWNER_ENTRY, BUSINESS_MANAGER_ROLE],
} as const satisfies Record<string, readonly string[]>;

export type AgencyPermission = keyof typeof AGENCY_PERMISSIONS;

export type AgencyActor = { isOwner: boolean; role: string };

export const isAgencyRoleAllowed = (
  permission: AgencyPermission,
  actor: AgencyActor,
): boolean => {
  const entries = AGENCY_PERMISSIONS[permission] as readonly string[];
  if (actor.isOwner) return entries.includes(OWNER_ENTRY);
  return entries.filter((entry) => entry !== OWNER_ENTRY).includes(actor.role);
};
