import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import {
  contractWebhook,
  acceptContractOffer,
  getClientContracts,
  getFreelancerContracts,
  startContractCheckout,
  submitMilestoneWork,
  reviewMilestoneWork,
  startMilestoneFundingCheckout,
  createAdditionalMilestone,
  finishContract,
} from "./contracts.controller.js";

export const contractsRouter = Router();

contractsRouter.post("/webhook", contractWebhook);
contractsRouter.get("/client", isAuthenticated, getClientContracts);
contractsRouter.get("/freelancer", isAuthenticated, getFreelancerContracts);
contractsRouter.patch(
  "/:contractId/accept",
  isAuthenticated,
  acceptContractOffer,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/submit",
  isAuthenticated,
  submitMilestoneWork,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/review",
  isAuthenticated,
  reviewMilestoneWork,
);
contractsRouter.post("/checkout", isAuthenticated, startContractCheckout);
contractsRouter.post(
  "/:contractId/milestones/:milestoneId/checkout",
  isAuthenticated,
  startMilestoneFundingCheckout,
);
contractsRouter.post(
  "/:contractId/milestones",
  isAuthenticated,
  createAdditionalMilestone,
);
contractsRouter.post("/:contractId/finish", isAuthenticated, finishContract);
