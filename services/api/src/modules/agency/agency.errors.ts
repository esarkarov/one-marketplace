import { ApiError } from "../../shared/http/api-error.js";

export const AGENCY_MEMBER_UNIQUE = "agency_members_freelancer_id_unique";
export const AGENCY_OWNER_UNIQUE = "agency_metadata_owner_id_unique";

export const alreadyInAgencyError = (message: string) =>
  new ApiError(409, message, "ALREADY_IN_AGENCY");

export const ALREADY_IN_AGENCY_MESSAGE =
  "You're already part of an agency. Leave your current agency before joining a new one.";

export const invitationHandledError = () =>
  new ApiError(
    409,
    "This invitation has already been handled.",
    "INVITATION_ALREADY_HANDLED",
  );
