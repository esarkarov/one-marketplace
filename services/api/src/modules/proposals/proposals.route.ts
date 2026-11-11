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

export const proposalRouter = Router();

proposalRouter.get("/", isAuthenticated, getProposals);
proposalRouter.get("/metadata", isAuthenticated, getProposalMetadata);
proposalRouter.post(
  "/",
  isAuthenticated,
  validate({ body: submitProposalBodySchema }),
  createProposal,
);
proposalRouter.patch(
  "/:proposalId/status",
  isAuthenticated,
  updateProposalStatus,
);
proposalRouter.post(
  "/:proposalId/interview",
  isAuthenticated,
  interviewProposal,
);
