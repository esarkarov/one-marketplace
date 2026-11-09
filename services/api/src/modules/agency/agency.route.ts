import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
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

export const agencyRouter = Router();

agencyRouter.get("/search", searchPublicAgenciesHandler);
agencyRouter.get("/profile/:id", getPublicAgencyHandler);
agencyRouter.get("/mine", isAuthenticated, getLoggedInAgency);
agencyRouter.get("/membership", isAuthenticated, getAgencyMembershipHandler);
agencyRouter.get(
  "/verification",
  isAuthenticated,
  getAgencyVerificationHandler,
);
agencyRouter.post("/", isAuthenticated, createAgencyHandler);
agencyRouter.put("/", isAuthenticated, updateAgencyHandler);
agencyRouter.get("/jobs", isAuthenticated, getAgencyJobFeed);
agencyRouter.get("/connects", isAuthenticated, getAgencyConnects);
agencyRouter.get(
  "/connects/history",
  isAuthenticated,
  getAgencyConnectsHistoryHandler,
);
agencyRouter.post("/connects/checkout", isAuthenticated, buyAgencyConnects);
agencyRouter.get("/proposals", isAuthenticated, getAgencyProposalsHandler);
agencyRouter.post("/proposals", isAuthenticated, submitAgencyProposalHandler);
agencyRouter.get(
  "/proposals/metadata",
  isAuthenticated,
  getAgencyProposalMetadataHandler,
);
agencyRouter.get(
  "/earnings/summary",
  isAuthenticated,
  getAgencyEarningsSummaryHandler,
);
agencyRouter.get(
  "/earnings/overview",
  isAuthenticated,
  getAgencyEarningsOverviewHandler,
);
agencyRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  getAgencyPayoutManagementLinkHandler,
);
agencyRouter.get(
  "/team/invitations",
  isAuthenticated,
  getAgencyTeamInvitationsHandler,
);
agencyRouter.post(
  "/team/invitations",
  isAuthenticated,
  inviteAgencyMemberHandler,
);
agencyRouter.delete(
  "/team/invitations/:invitationId",
  isAuthenticated,
  cancelAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/invitations/:invitationId",
  isAuthenticated,
  updateAgencyInvitationRoleHandler,
);
agencyRouter.post(
  "/team/invitations/:invitationId/resend",
  isAuthenticated,
  resendAgencyInvitationHandler,
);
agencyRouter.patch(
  "/team/members/:memberId",
  isAuthenticated,
  updateAgencyMemberRoleHandler,
);
agencyRouter.delete(
  "/team/members/:memberId",
  isAuthenticated,
  removeAgencyMemberHandler,
);
agencyRouter.get(
  "/invitations/mine",
  isAuthenticated,
  getMyAgencyInvitationsHandler,
);
agencyRouter.patch(
  "/invitations/:invitationId/respond",
  isAuthenticated,
  respondToAgencyInvitationHandler,
);
