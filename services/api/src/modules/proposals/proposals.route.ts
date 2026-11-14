import { Router } from "express";
import { validate } from "../../shared/http/validate.middleware.js";
import { isAuthenticated } from "../auth/auth.public.js";
import { submitProposalBodySchema } from "../../shared/validation/money-schemas.js";
import {
  createProposal,
  getProposalMetadata,
  getProposals,
  interviewProposal,
  updateProposalStatus,
} from "./proposals.controller.js";
import {
  proposalsCreateResponses,
  proposalsInterviewResponses,
  proposalsListResponses,
  proposalsMetadataResponses,
  proposalsStatusResponses,
} from "./proposals.responses.js";
import {
  interviewProposalBodySchema,
  listProposalsQuerySchema,
  proposalIdParamsSchema,
  roleOnlyQuerySchema,
  updateProposalStatusBodySchema,
} from "./proposals.schemas.js";

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
    query: roleOnlyQuerySchema,
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
