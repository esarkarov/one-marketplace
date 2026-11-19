import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "@/modules/auth/index.js";
import { validate } from "@/middleware/validate/validate.middleware.js";
import { largeJsonBody } from "@/middleware/json-body/json-body.middleware.js";
import { publicSearchLimiter } from "@/middleware/rate-limit/rate-limit.middleware.js";
import {
  contentWriteLimiter,
  inviteWriteLimiter,
} from "@/middleware/rate-limit/user-rate-limit.middleware.js";
import {
  createAgencyHandler,
  getAgencyJobFeed,
  getLoggedInAgency,
  getPublicAgencyHandler,
  searchPublicAgenciesHandler,
  updateAgencyHandler,
} from "./controllers/agency.controller.js";
import {
  buyAgencyConnects,
  getAgencyConnects,
  getAgencyConnectsHistoryHandler,
} from "./controllers/agency.connects.controller.js";
import {
  getAgencyEarningsOverviewHandler,
  getAgencyEarningsSummaryHandler,
  getAgencyPayoutManagementLinkHandler,
} from "./controllers/agency.earnings.controller.js";
import {
  cancelAgencyInvitationHandler,
  getAgencyMembershipHandler,
  getAgencyTeamInvitationsHandler,
  getAgencyVerificationHandler,
  getMyAgencyInvitationsHandler,
  inviteAgencyMemberHandler,
  removeAgencyMemberHandler,
  resendAgencyInvitationHandler,
  respondToAgencyInvitationHandler,
  updateAgencyInvitationRoleHandler,
  updateAgencyMemberRoleHandler,
} from "./controllers/agency.invitations.controller.js";
import {
  agencyConnectsCheckoutResponses,
  agencyConnectsHistoryResponses,
  agencyConnectsResponses,
  agencyCreateResponses,
  agencyEarningsOverviewResponses,
  agencyEarningsSummaryResponses,
  agencyInvitationMutationResponses,
  agencyInviteResponses,
  agencyJobFeedResponses,
  agencyMemberMutationResponses,
  agencyMembershipResponses,
  agencyMineResponses,
  agencyMyInvitationsResponses,
  agencyPayoutLinkResponses,
  agencyPublicProfileResponses,
  agencyRespondResponses,
  agencyResendInvitationResponses,
  agencySearchResponses,
  agencyTeamInvitationsResponses,
  agencyUpdateResponses,
  agencyVerificationResponses,
} from "./responses/agency.responses.js";
import { authRoleShape } from "@/shared/validation/schemas/common.schema.js";
import {
  agencyConnectsHistoryRequest,
  agencyJobFeedRequest,
  agencySearchRequest,
  agencyTeamInvitationsRequest,
  buyAgencyConnectsRequest,
  cancelAgencyInvitationRequest,
  createAgencyRequest,
  inviteAgencyMemberRequest,
  myAgencyInvitationsRequest,
  publicAgencyRequest,
  removeAgencyMemberRequest,
  resendAgencyInvitationRequest,
  respondToAgencyInvitationRequest,
  updateAgencyInvitationRoleRequest,
  updateAgencyMemberRoleRequest,
  updateAgencyRequest,
} from "./schemas/agency.schema.js";

export const agencyRouter = Router();

const agencyWriteLimiter = contentWriteLimiter("agency-content-write");

agencyRouter.get(
  "/search",
  publicSearchLimiter,
  validate({ ...agencySearchRequest, responses: agencySearchResponses }),
  searchPublicAgenciesHandler,
);
agencyRouter.get(
  "/profile/:id",
  validate({ ...publicAgencyRequest, responses: agencyPublicProfileResponses }),
  getPublicAgencyHandler,
);
agencyRouter.get(
  "/mine",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyMineResponses }),
  getLoggedInAgency,
);
agencyRouter.get(
  "/membership",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyMembershipResponses }),
  getAgencyMembershipHandler,
);
agencyRouter.get(
  "/verification",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyVerificationResponses }),
  getAgencyVerificationHandler,
);
agencyRouter.post(
  "/",
  isAuthenticated,
  validate({ ...createAgencyRequest, responses: agencyCreateResponses }),
  createAgencyHandler,
);
agencyRouter.put(
  "/",
  verifyBearerToken,
  agencyWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ ...updateAgencyRequest, responses: agencyUpdateResponses }),
  updateAgencyHandler,
);
agencyRouter.get(
  "/jobs",
  isAuthenticated,
  validate({ ...agencyJobFeedRequest, responses: agencyJobFeedResponses }),
  getAgencyJobFeed,
);
agencyRouter.get(
  "/connects",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyConnectsResponses }),
  getAgencyConnects,
);
agencyRouter.get(
  "/connects/history",
  isAuthenticated,
  validate({
    ...agencyConnectsHistoryRequest,
    responses: agencyConnectsHistoryResponses,
  }),
  getAgencyConnectsHistoryHandler,
);
agencyRouter.post(
  "/connects/checkout",
  isAuthenticated,
  validate({
    ...buyAgencyConnectsRequest,
    responses: agencyConnectsCheckoutResponses,
  }),
  buyAgencyConnects,
);
agencyRouter.get(
  "/earnings/summary",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyEarningsSummaryResponses }),
  getAgencyEarningsSummaryHandler,
);
agencyRouter.get(
  "/earnings/overview",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: agencyEarningsOverviewResponses,
  }),
  getAgencyEarningsOverviewHandler,
);
agencyRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyPayoutLinkResponses }),
  getAgencyPayoutManagementLinkHandler,
);
agencyRouter.get(
  "/team/invitations",
  isAuthenticated,
  validate({
    ...agencyTeamInvitationsRequest,
    responses: agencyTeamInvitationsResponses,
  }),
  getAgencyTeamInvitationsHandler,
);
agencyRouter.post(
  "/team/invitations",
  isAuthenticated,
  inviteWriteLimiter,
  validate({ ...inviteAgencyMemberRequest, responses: agencyInviteResponses }),
  inviteAgencyMemberHandler,
);
agencyRouter.delete(
  "/team/invitations/:invitationId",
  isAuthenticated,
  inviteWriteLimiter,
  validate({
    ...cancelAgencyInvitationRequest,
    responses: agencyInvitationMutationResponses,
  }),
  cancelAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/invitations/:invitationId",
  isAuthenticated,
  validate({
    ...updateAgencyInvitationRoleRequest,
    responses: agencyInvitationMutationResponses,
  }),
  updateAgencyInvitationRoleHandler,
);
agencyRouter.post(
  "/team/invitations/:invitationId/resend",
  isAuthenticated,
  inviteWriteLimiter,
  validate({
    ...resendAgencyInvitationRequest,
    responses: agencyResendInvitationResponses,
  }),
  resendAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/members/:memberId",
  isAuthenticated,
  validate({
    ...updateAgencyMemberRoleRequest,
    responses: agencyMemberMutationResponses,
  }),
  updateAgencyMemberRoleHandler,
);
agencyRouter.delete(
  "/team/members/:memberId",
  isAuthenticated,
  validate({
    ...removeAgencyMemberRequest,
    responses: agencyMemberMutationResponses,
  }),
  removeAgencyMemberHandler,
);
agencyRouter.get(
  "/invitations/mine",
  isAuthenticated,
  validate({
    ...myAgencyInvitationsRequest,
    responses: agencyMyInvitationsResponses,
  }),
  getMyAgencyInvitationsHandler,
);
agencyRouter.patch(
  "/invitations/:invitationId/respond",
  isAuthenticated,
  validate({
    ...respondToAgencyInvitationRequest,
    responses: agencyRespondResponses,
  }),
  respondToAgencyInvitationHandler,
);
