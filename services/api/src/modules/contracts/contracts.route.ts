import { Router } from "express";
import { isAuthenticated } from "../auth/index.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  contractWebhook,
  acceptContractOffer,
  declineContractOffer,
  withdrawContractOffer,
  getClientContracts,
  getFreelancerContracts,
  startContractCheckout,
  submitMilestoneWork,
  reviewMilestoneWork,
  startMilestoneFundingCheckout,
  createAdditionalMilestone,
  finishContract,
} from "./controllers/contracts.controller.js";
import {
  acceptContractRequest,
  addMilestoneRequest,
  clientContractsRequest,
  contractCheckoutRequest,
  declineContractRequest,
  finishContractRequest,
  freelancerContractsRequest,
  milestoneCheckoutRequest,
  reviewMilestoneRequest,
  submitMilestoneRequest,
  withdrawContractRequest,
} from "./schemas/contracts.schema.js";
import { contractsResponses } from "./responses/contracts.responses.js";

export const contractsRouter = Router();

contractsRouter.post("/webhook", contractWebhook);
contractsRouter.get(
  "/client",
  isAuthenticated,
  validate({ ...clientContractsRequest, responses: contractsResponses.client }),
  getClientContracts,
);
contractsRouter.get(
  "/freelancer",
  isAuthenticated,
  validate({
    ...freelancerContractsRequest,
    responses: contractsResponses.freelancer,
  }),
  getFreelancerContracts,
);
contractsRouter.patch(
  "/:contractId/accept",
  isAuthenticated,
  validate({ ...acceptContractRequest, responses: contractsResponses.accept }),
  acceptContractOffer,
);
contractsRouter.patch(
  "/:contractId/decline",
  isAuthenticated,
  validate({
    ...declineContractRequest,
    responses: contractsResponses.decline,
  }),
  declineContractOffer,
);
contractsRouter.patch(
  "/:contractId/withdraw",
  isAuthenticated,
  validate({
    ...withdrawContractRequest,
    responses: contractsResponses.withdraw,
  }),
  withdrawContractOffer,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/submit",
  isAuthenticated,
  validate({ ...submitMilestoneRequest, responses: contractsResponses.submit }),
  submitMilestoneWork,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/review",
  isAuthenticated,
  validate({ ...reviewMilestoneRequest, responses: contractsResponses.review }),
  reviewMilestoneWork,
);
contractsRouter.post(
  "/checkout",
  isAuthenticated,
  validate({
    ...contractCheckoutRequest,
    responses: contractsResponses.checkout,
  }),
  startContractCheckout,
);
contractsRouter.post(
  "/:contractId/milestones/:milestoneId/checkout",
  isAuthenticated,
  validate({
    ...milestoneCheckoutRequest,
    responses: contractsResponses.milestoneCheckout,
  }),
  startMilestoneFundingCheckout,
);
contractsRouter.post(
  "/:contractId/milestones",
  isAuthenticated,
  validate({
    ...addMilestoneRequest,
    responses: contractsResponses.addMilestone,
  }),
  createAdditionalMilestone,
);
contractsRouter.post(
  "/:contractId/finish",
  isAuthenticated,
  validate({ ...finishContractRequest, responses: contractsResponses.finish }),
  finishContract,
);
