import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
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
proposalRouter.post("/", isAuthenticated, createProposal);
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
