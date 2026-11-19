import { Router } from "express";
import { validate } from "../../middleware/validate/validate.middleware.js";
import { isAuthenticated } from "../auth/index.js";
import {
  agencyProposalMetadataRequest,
  agencyProposalsRequest,
  createProposalRequest,
  interviewProposalRequest,
  listProposalsRequest,
  proposalMetadataRequest,
  submitAgencyProposalRequest,
  updateProposalStatusRequest,
} from "./schemas/proposals.schema.js";
import {
  agencyProposalMetadataResponses,
  agencyProposalsResponses,
  agencySubmitProposalResponses,
} from "../agency/index.js";
import {
  createProposal,
  getAgencyProposalMetadataHandler,
  getAgencyProposalsHandler,
  getProposalMetadata,
  getProposals,
  interviewProposal,
  submitAgencyProposalHandler,
  updateProposalStatus,
} from "./controllers/proposals.controller.js";
import {
  proposalsCreateResponses,
  proposalsInterviewResponses,
  proposalsListResponses,
  proposalsMetadataResponses,
  proposalsStatusResponses,
} from "./responses/proposals.responses.js";

export const proposalRouter = Router();

proposalRouter.get(
  "/",
  isAuthenticated,
  validate({ ...listProposalsRequest, responses: proposalsListResponses }),
  getProposals,
);
proposalRouter.get(
  "/metadata",
  isAuthenticated,
  validate({
    ...proposalMetadataRequest,
    responses: proposalsMetadataResponses,
  }),
  getProposalMetadata,
);
proposalRouter.post(
  "/",
  isAuthenticated,
  validate({ ...createProposalRequest, responses: proposalsCreateResponses }),
  createProposal,
);
proposalRouter.patch(
  "/:proposalId/status",
  isAuthenticated,
  validate({
    ...updateProposalStatusRequest,
    responses: proposalsStatusResponses,
  }),
  updateProposalStatus,
);
proposalRouter.post(
  "/:proposalId/interview",
  isAuthenticated,
  validate({
    ...interviewProposalRequest,
    responses: proposalsInterviewResponses,
  }),
  interviewProposal,
);

export const agencyProposalsRouter = Router();

agencyProposalsRouter.get(
  "/proposals",
  isAuthenticated,
  validate({ ...agencyProposalsRequest, responses: agencyProposalsResponses }),
  getAgencyProposalsHandler,
);
agencyProposalsRouter.post(
  "/proposals",
  isAuthenticated,
  validate({
    ...submitAgencyProposalRequest,
    responses: agencySubmitProposalResponses,
  }),
  submitAgencyProposalHandler,
);
agencyProposalsRouter.get(
  "/proposals/metadata",
  isAuthenticated,
  validate({
    ...agencyProposalMetadataRequest,
    responses: agencyProposalMetadataResponses,
  }),
  getAgencyProposalMetadataHandler,
);
