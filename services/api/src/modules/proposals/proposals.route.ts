import { Router } from "express";
import { validate } from "../../middleware/validate/validate.middleware.js";
import { isAuthenticated } from "../auth/index.js";
import { authRoleShape } from "../../shared/validation/schemas/common.schema.js";
import { roleListQuerySchema } from "../../shared/validation/schemas/pagination.schema.js";
import { submitProposalBodySchema } from "./schemas/proposals.schema.js";
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
import {
  interviewProposalBodySchema,
  listProposalsQuerySchema,
  proposalIdParamsSchema,
  roleOnlyQuerySchema,
  updateProposalStatusBodySchema,
} from "./schemas/proposals.schema.js";

export const proposalRouter = Router();

proposalRouter.get(
  "/",
  isAuthenticated,
  validate({
    query: listProposalsQuerySchema,
    responses: proposalsListResponses,
  }),
  getProposals,
);
proposalRouter.get(
  "/metadata",
  isAuthenticated,
  validate({
    query: roleListQuerySchema,
    responses: proposalsMetadataResponses,
  }),
  getProposalMetadata,
);
proposalRouter.post(
  "/",
  isAuthenticated,
  validate({
    query: roleOnlyQuerySchema,
    body: submitProposalBodySchema,
    responses: proposalsCreateResponses,
  }),
  createProposal,
);
proposalRouter.patch(
  "/:proposalId/status",
  isAuthenticated,
  validate({
    params: proposalIdParamsSchema,
    query: roleOnlyQuerySchema,
    body: updateProposalStatusBodySchema,
    responses: proposalsStatusResponses,
  }),
  updateProposalStatus,
);
proposalRouter.post(
  "/:proposalId/interview",
  isAuthenticated,
  validate({
    params: proposalIdParamsSchema,
    query: roleOnlyQuerySchema,
    body: interviewProposalBodySchema,
    responses: proposalsInterviewResponses,
  }),
  interviewProposal,
);

export const agencyProposalsRouter = Router();

agencyProposalsRouter.get(
  "/proposals",
  isAuthenticated,
  validate({ query: roleListQuerySchema, responses: agencyProposalsResponses }),
  getAgencyProposalsHandler,
);
agencyProposalsRouter.post(
  "/proposals",
  isAuthenticated,
  validate({
    query: authRoleShape,
    body: submitProposalBodySchema,
    responses: agencySubmitProposalResponses,
  }),
  submitAgencyProposalHandler,
);
agencyProposalsRouter.get(
  "/proposals/metadata",
  isAuthenticated,
  validate({
    query: roleListQuerySchema,
    responses: agencyProposalMetadataResponses,
  }),
  getAgencyProposalMetadataHandler,
);
