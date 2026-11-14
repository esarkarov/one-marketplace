import { RequestHandler } from "express";
import { asyncHandler } from "../../../shared/http/async-handler.js";
import { ApiError } from "../../../shared/http/api-error.js";
import { isValidEmail } from "../../../shared/validation/email.js";
import { requireText } from "../../../config/constants.js";
import {
  cancelAgencyInvitation,
  getAgencyInvitations,
  getMyAgencyInvitations,
  inviteAgencyMember,
  resendAgencyInvitation,
  respondToAgencyInvitation,
  updateAgencyInvitationRole,
} from "../services/agency.invitations.service.js";
import {
  getAgencyIdForMember,
  removeAgencyMember,
  requireAgencyPermission,
  updateAgencyMemberRole,
} from "../services/agency.membership.service.js";
import { getAgencyOwnerVerification } from "../services/agency.profile.service.js";
import { requireAgencyAuth, requireAgencyOwner } from "../utils/agency.auth.js";

export const getAgencyTeamInvitationsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const { agencyId } = await requireAgencyPermission(
      auth.userId,
      "team.invitations.view",
    );
    const invitations = agencyId ? await getAgencyInvitations(agencyId) : [];

    response.status(200).json({
      success: true,
      message: "Agency invitations retrieved.",
      data: invitations,
    });
  },
);

export const inviteAgencyMemberHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const email = requireText(request.body?.email, "Email").toLowerCase();
    const role = request.body?.memberRole ?? "Agency member";
    if (!isValidEmail(email)) {
      throw new ApiError(400, "Enter a valid email address.");
    }

    const invitation = await inviteAgencyMember(
      agency.id,
      agency.name,
      auth.userId,
      {
        email,
        role,
      },
    );

    response.status(201).json({
      success: true,
      message: "Invitation sent.",
      data: invitation,
    });
  },
);

export const cancelAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await cancelAgencyInvitation(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
    );

    response.status(200).json({
      success: true,
      message: "Invitation cancelled.",
      data: null,
    });
  },
);

export const updateAgencyInvitationRoleHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const role = request.body?.memberRole ?? "Agency member";

    await updateAgencyInvitationRole(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
      role,
    );

    response.status(200).json({
      success: true,
      message: "Invitation role updated.",
      data: null,
    });
  },
);

export const resendAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await resendAgencyInvitation(
      agency.id,
      requireText(request.params.invitationId, "Invitation"),
      agency.name,
    );

    response.status(200).json({
      success: true,
      message: "Invitation resent.",
      data: null,
    });
  },
);

export const updateAgencyMemberRoleHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    const role = request.body?.memberRole ?? "Agency member";

    await updateAgencyMemberRole(
      agency.id,
      requireText(request.params.memberId, "Member"),
      role,
    );

    response.status(200).json({
      success: true,
      message: "Member role updated.",
      data: null,
    });
  },
);

export const removeAgencyMemberHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agency = await requireAgencyOwner(auth.userId);

    await removeAgencyMember(
      agency.id,
      requireText(request.params.memberId, "Member"),
    );

    response.status(200).json({
      success: true,
      message: "Member removed.",
      data: null,
    });
  },
);

export const getMyAgencyInvitationsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const invitations = await getMyAgencyInvitations(auth.userId);

    response.status(200).json({
      success: true,
      message: "Your agency invitations were retrieved.",
      data: invitations,
    });
  },
);

export const respondToAgencyInvitationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const accept = request.body?.accept === true;

    const result = await respondToAgencyInvitation(
      requireText(request.params.invitationId, "Invitation"),
      auth.userId,
      accept,
    );

    response.status(200).json({
      success: true,
      message: accept ? "Invitation accepted." : "Invitation declined.",
      data: result,
    });
  },
);

export const getAgencyMembershipHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agencyId = await getAgencyIdForMember(auth.userId);

    response.status(200).json({
      success: true,
      message: "Agency membership retrieved.",
      data: { agencyId },
    });
  },
);

export const getAgencyVerificationHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const agencyId = await getAgencyIdForMember(auth.userId);
    const owner = agencyId ? await getAgencyOwnerVerification(agencyId) : null;

    const data = {
      identityVerified: owner?.identityVerified ?? false,
      isOwner: Boolean(owner && owner.ownerId === auth.userId),
    };

    response.status(200).json({
      success: true,
      message: "Agency verification status retrieved.",
      data,
    });
  },
);
