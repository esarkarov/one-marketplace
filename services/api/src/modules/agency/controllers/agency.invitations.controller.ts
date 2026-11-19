import {
  MEMBER_ROLE,
  toStoredMemberRole,
} from "@/modules/agency/constants/agency.constants.js";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import {
  agencyTeamInvitationsRequest,
  cancelAgencyInvitationRequest,
  inviteAgencyMemberRequest,
  myAgencyInvitationsRequest,
  removeAgencyMemberRequest,
  resendAgencyInvitationRequest,
  respondToAgencyInvitationRequest,
  updateAgencyInvitationRoleRequest,
  updateAgencyMemberRoleRequest,
} from "@/modules/agency/schemas/agency.schema.js";
import { ApiError } from "@/shared/errors/api-error.js";
import { isValidEmail } from "@/shared/validation/utils/email.utils.js";
import { requireText } from "@/shared/validation/utils/require-text.utils.js";
import {
  cancelAgencyInvitation,
  getAgencyInvitations,
  getMyAgencyInvitations,
  inviteAgencyMember,
  resendAgencyInvitation,
  respondToAgencyInvitation,
  updateAgencyInvitationRole,
} from "@/modules/agency/services/agency.invitations.service.js";
import {
  getAgencyIdForMember,
  removeAgencyMember,
  requireAgencyPermission,
  updateAgencyMemberRole,
} from "@/modules/agency/services/agency.membership.service.js";
import { getAgencyOwnerVerification } from "@/modules/agency/services/agency.profile.service.js";
import {
  requireAgencyAuth,
  requireAgencyOwner,
} from "@/modules/agency/utils/agency.auth.js";

export const getAgencyTeamInvitationsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const auth = requireAgencyAuth(request);
    const { agencyId } = await requireAgencyPermission(
      auth.userId,
      "team.invitations.view",
    );
    const { query } = getValidated(request, agencyTeamInvitationsRequest);
    const invitations = agencyId
      ? await getAgencyInvitations(agencyId, {
          limit: query.limit,
          offset: query.offset,
        })
      : { results: [], hasMore: false };

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

    const { body } = getValidated(request, inviteAgencyMemberRequest);
    const email = requireText(body.email, "Email").toLowerCase();
    const role = toStoredMemberRole(
      body.memberRole ?? MEMBER_ROLE.AGENCY_MEMBER,
    );
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

    const { params } = getValidated(request, cancelAgencyInvitationRequest);
    await cancelAgencyInvitation(
      agency.id,
      requireText(params.invitationId, "Invitation"),
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

    const { params, body } = getValidated(
      request,
      updateAgencyInvitationRoleRequest,
    );
    const role = toStoredMemberRole(
      body.memberRole ?? MEMBER_ROLE.AGENCY_MEMBER,
    );

    await updateAgencyInvitationRole(
      agency.id,
      requireText(params.invitationId, "Invitation"),
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

    const { params } = getValidated(request, resendAgencyInvitationRequest);
    await resendAgencyInvitation(
      agency.id,
      requireText(params.invitationId, "Invitation"),
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

    const { params, body } = getValidated(
      request,
      updateAgencyMemberRoleRequest,
    );
    const role = toStoredMemberRole(
      body.memberRole ?? MEMBER_ROLE.AGENCY_MEMBER,
    );

    await updateAgencyMemberRole(
      agency.id,
      requireText(params.memberId, "Member"),
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

    const { params } = getValidated(request, removeAgencyMemberRequest);
    await removeAgencyMember(agency.id, requireText(params.memberId, "Member"));

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
    const { query } = getValidated(request, myAgencyInvitationsRequest);
    const invitations = await getMyAgencyInvitations(auth.userId, {
      limit: query.limit,
      offset: query.offset,
    });

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
    const { params, body } = getValidated(
      request,
      respondToAgencyInvitationRequest,
    );
    const accept = body.accept === true;

    const result = await respondToAgencyInvitation(
      requireText(params.invitationId, "Invitation"),
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
