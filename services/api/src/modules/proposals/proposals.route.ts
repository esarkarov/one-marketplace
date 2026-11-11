import { Router } from "express";
import { validate } from "../../middleware/validate.middleware.js";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { submitProposalBodySchema } from "../../utils/money-schemas.js";
import {
  createProposal,
  getProposalMetadata,
  getProposals,
  interviewProposal,
  updateProposalStatus,
} from "./proposals.controller.js";
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
  validate({ query: listProposalsQuerySchema }),
  getProposals,
);
proposalRouter.get(
  "/metadata",
  isAuthenticated,
  validate({ query: roleOnlyQuerySchema }),
  getProposalMetadata,
);
proposalRouter.post(
  "/",
  isAuthenticated,
  validate({ query: roleOnlyQuerySchema, body: submitProposalBodySchema }),
  createProposal,
);
proposalRouter.patch(
  "/:proposalId/status",
  isAuthenticated,
  validate({
    params: proposalIdParamsSchema,
    query: roleOnlyQuerySchema,
    body: updateProposalStatusBodySchema,
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
  }),
  interviewProposal,
);
