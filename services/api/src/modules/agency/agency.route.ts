import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../auth/index.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import { largeJsonBody } from "../../middleware/json-body/json-body.middleware.js";
import { publicSearchLimiter } from "../../middleware/rate-limit/rate-limit.middleware.js";
import {
  contentWriteLimiter,
  inviteWriteLimiter,
} from "../../middleware/rate-limit/user-rate-limit.middleware.js";
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
import { authRoleShape } from "../../shared/validation/schemas/common.schema.js";
import { roleListQuerySchema } from "../../shared/validation/schemas/pagination.schema.js";
import {
  agencyJobFeedQuerySchema,
  agencyTalentSearchQuerySchema,
  connectsCheckoutBodySchema,
  createAgencyBodySchema,
  inviteMemberBodySchema,
  invitationParamsSchema,
  memberParamsSchema,
  memberRoleBodySchema,
  publicAgencyParamsSchema,
  respondInvitationBodySchema,
  updateAgencyBodySchema,
} from "./schemas/agency.schema.js";

export const agencyRouter = Router();

const agencyWriteLimiter = contentWriteLimiter("agency-content-write");

agencyRouter.get(
  "/search",
  publicSearchLimiter,
  validate({
    query: agencyTalentSearchQuerySchema,
    responses: agencySearchResponses,
  }),
  searchPublicAgenciesHandler,
);
agencyRouter.get(
  "/profile/:id",
  validate({
    params: publicAgencyParamsSchema,
    query: {},
    responses: agencyPublicProfileResponses,
  }),
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
  validate({
    query: authRoleShape,
    body: createAgencyBodySchema,
    responses: agencyCreateResponses,
  }),
  createAgencyHandler,
);
agencyRouter.put(
  "/",
  verifyBearerToken,
  agencyWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({
    query: authRoleShape,
    body: updateAgencyBodySchema,
    responses: agencyUpdateResponses,
  }),
  updateAgencyHandler,
);
agencyRouter.get(
  "/jobs",
  isAuthenticated,
  validate({
    query: agencyJobFeedQuerySchema,
    responses: agencyJobFeedResponses,
  }),
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
    query: roleListQuerySchema,
    responses: agencyConnectsHistoryResponses,
  }),
  getAgencyConnectsHistoryHandler,
);
agencyRouter.post(
  "/connects/checkout",
  isAuthenticated,
  validate({
    query: authRoleShape,
    body: connectsCheckoutBodySchema,
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
    query: roleListQuerySchema,
    responses: agencyTeamInvitationsResponses,
  }),
  getAgencyTeamInvitationsHandler,
);
agencyRouter.post(
  "/team/invitations",
  isAuthenticated,
  inviteWriteLimiter,
  validate({
    query: authRoleShape,
    body: inviteMemberBodySchema,
    responses: agencyInviteResponses,
  }),
  inviteAgencyMemberHandler,
);
agencyRouter.delete(
  "/team/invitations/:invitationId",
  isAuthenticated,
  inviteWriteLimiter,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    responses: agencyInvitationMutationResponses,
  }),
  cancelAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/invitations/:invitationId",
  isAuthenticated,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    body: memberRoleBodySchema,
    responses: agencyInvitationMutationResponses,
  }),
  updateAgencyInvitationRoleHandler,
);
agencyRouter.post(
  "/team/invitations/:invitationId/resend",
  isAuthenticated,
  inviteWriteLimiter,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    responses: agencyResendInvitationResponses,
  }),
  resendAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/members/:memberId",
  isAuthenticated,
  validate({
    params: memberParamsSchema,
    query: authRoleShape,
    body: memberRoleBodySchema,
    responses: agencyMemberMutationResponses,
  }),
  updateAgencyMemberRoleHandler,
);
agencyRouter.delete(
  "/team/members/:memberId",
  isAuthenticated,
  validate({
    params: memberParamsSchema,
    query: authRoleShape,
    responses: agencyMemberMutationResponses,
  }),
  removeAgencyMemberHandler,
);
agencyRouter.get(
  "/invitations/mine",
  isAuthenticated,
  validate({
    query: roleListQuerySchema,
    responses: agencyMyInvitationsResponses,
  }),
  getMyAgencyInvitationsHandler,
);
agencyRouter.patch(
  "/invitations/:invitationId/respond",
  isAuthenticated,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    body: respondInvitationBodySchema,
    responses: agencyRespondResponses,
  }),
  respondToAgencyInvitationHandler,
);
