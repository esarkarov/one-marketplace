import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
import { publicSearchLimiter } from "../../middleware/rate-limit.middleware.js";
import {
  contentWriteLimiter,
  inviteWriteLimiter,
} from "../../middleware/user-rate-limit.middleware.js";
import {
  buyAgencyConnects,
  cancelAgencyInvitationHandler,
  createAgencyHandler,
  getAgencyConnects,
  getAgencyConnectsHistoryHandler,
  getAgencyEarningsOverviewHandler,
  getAgencyEarningsSummaryHandler,
  getAgencyJobFeed,
  getAgencyMembershipHandler,
  getAgencyVerificationHandler,
  getAgencyPayoutManagementLinkHandler,
  getAgencyProposalMetadataHandler,
  getAgencyProposalsHandler,
  getAgencyTeamInvitationsHandler,
  getLoggedInAgency,
  getMyAgencyInvitationsHandler,
  getPublicAgencyHandler,
  inviteAgencyMemberHandler,
  removeAgencyMemberHandler,
  resendAgencyInvitationHandler,
  respondToAgencyInvitationHandler,
  searchPublicAgenciesHandler,
  submitAgencyProposalHandler,
  updateAgencyHandler,
  updateAgencyInvitationRoleHandler,
  updateAgencyMemberRoleHandler,
} from "./agency.controller.js";
import { authRoleShape } from "../../utils/common-schemas.js";
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
} from "./agency.schemas.js";
import { submitProposalBodySchema } from "../../utils/money-schemas.js";

export const agencyRouter = Router();

const agencyWriteLimiter = contentWriteLimiter();

agencyRouter.get(
  "/search",
  publicSearchLimiter,
  validate({ query: agencyTalentSearchQuerySchema }),
  searchPublicAgenciesHandler,
);
agencyRouter.get(
  "/profile/:id",
  validate({ params: publicAgencyParamsSchema, query: {} }),
  getPublicAgencyHandler,
);
agencyRouter.get(
  "/mine",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getLoggedInAgency,
);
agencyRouter.get(
  "/membership",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyMembershipHandler,
);
agencyRouter.get(
  "/verification",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyVerificationHandler,
);
agencyRouter.post(
  "/",
  isAuthenticated,
  validate({ query: authRoleShape, body: createAgencyBodySchema }),
  createAgencyHandler,
);
agencyRouter.put(
  "/",
  verifyBearerToken,
  agencyWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ query: authRoleShape, body: updateAgencyBodySchema }),
  updateAgencyHandler,
);
agencyRouter.get(
  "/jobs",
  isAuthenticated,
  validate({ query: agencyJobFeedQuerySchema }),
  getAgencyJobFeed,
);
agencyRouter.get(
  "/connects",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyConnects,
);
agencyRouter.get(
  "/connects/history",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyConnectsHistoryHandler,
);
agencyRouter.post(
  "/connects/checkout",
  isAuthenticated,
  validate({ query: authRoleShape, body: connectsCheckoutBodySchema }),
  buyAgencyConnects,
);
agencyRouter.get(
  "/proposals",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyProposalsHandler,
);
agencyRouter.post(
  "/proposals",
  isAuthenticated,
  validate({ query: authRoleShape, body: submitProposalBodySchema }),
  submitAgencyProposalHandler,
);
agencyRouter.get(
  "/proposals/metadata",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyProposalMetadataHandler,
);
agencyRouter.get(
  "/earnings/summary",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyEarningsSummaryHandler,
);
agencyRouter.get(
  "/earnings/overview",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyEarningsOverviewHandler,
);
agencyRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyPayoutManagementLinkHandler,
);
agencyRouter.get(
  "/team/invitations",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getAgencyTeamInvitationsHandler,
);
agencyRouter.post(
  "/team/invitations",
  isAuthenticated,
  inviteWriteLimiter,
  validate({ query: authRoleShape, body: inviteMemberBodySchema }),
  inviteAgencyMemberHandler,
);
agencyRouter.delete(
  "/team/invitations/:invitationId",
  isAuthenticated,
  inviteWriteLimiter,
  validate({ params: invitationParamsSchema, query: authRoleShape }),
  cancelAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/invitations/:invitationId",
  isAuthenticated,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    body: memberRoleBodySchema,
  }),
  updateAgencyInvitationRoleHandler,
);
agencyRouter.post(
  "/team/invitations/:invitationId/resend",
  isAuthenticated,
  inviteWriteLimiter,
  validate({ params: invitationParamsSchema, query: authRoleShape }),
  resendAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/members/:memberId",
  isAuthenticated,
  validate({
    params: memberParamsSchema,
    query: authRoleShape,
    body: memberRoleBodySchema,
  }),
  updateAgencyMemberRoleHandler,
);
agencyRouter.delete(
  "/team/members/:memberId",
  isAuthenticated,
  validate({ params: memberParamsSchema, query: authRoleShape }),
  removeAgencyMemberHandler,
);
agencyRouter.get(
  "/invitations/mine",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getMyAgencyInvitationsHandler,
);
agencyRouter.patch(
  "/invitations/:invitationId/respond",
  isAuthenticated,
  validate({
    params: invitationParamsSchema,
    query: authRoleShape,
    body: respondInvitationBodySchema,
  }),
  respondToAgencyInvitationHandler,
);
