import { Router } from "express";
import { isAuthenticated } from "../../shared/http/auth.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
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
import {
  addMilestoneBodySchema,
  contractCheckoutBodySchema,
  contractIdParamsSchema,
  finishContractBodySchema,
  milestoneCheckoutBodySchema,
  milestoneParamsSchema,
  reviewMilestoneBodySchema,
  roleOnlyQuerySchema,
  scopeQuerySchema,
  submitMilestoneBodySchema,
} from "./contracts.schemas.js";
import { contractsResponses } from "./contracts.responses.js";

export const contractsRouter = Router();

contractsRouter.post("/webhook", contractWebhook);
contractsRouter.get(
  "/client",
  isAuthenticated,
  validate({
    query: roleOnlyQuerySchema,
    responses: contractsResponses.client,
  }),
  getClientContracts,
);
contractsRouter.get(
  "/freelancer",
  isAuthenticated,
  validate({
    query: scopeQuerySchema,
    responses: contractsResponses.freelancer,
  }),
  getFreelancerContracts,
);
contractsRouter.patch(
  "/:contractId/accept",
  isAuthenticated,
  validate({
    params: contractIdParamsSchema,
    query: scopeQuerySchema,
    responses: contractsResponses.accept,
  }),
  acceptContractOffer,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/submit",
  isAuthenticated,
  validate({
    params: milestoneParamsSchema,
    query: scopeQuerySchema,
    body: submitMilestoneBodySchema,
    responses: contractsResponses.submit,
  }),
  submitMilestoneWork,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/review",
  isAuthenticated,
  validate({
    params: milestoneParamsSchema,
    query: roleOnlyQuerySchema,
    body: reviewMilestoneBodySchema,
    responses: contractsResponses.review,
  }),
  reviewMilestoneWork,
);
contractsRouter.post(
  "/checkout",
  isAuthenticated,
  validate({
    query: roleOnlyQuerySchema,
    body: contractCheckoutBodySchema,
    responses: contractsResponses.checkout,
  }),
  startContractCheckout,
);
contractsRouter.post(
  "/:contractId/milestones/:milestoneId/checkout",
  isAuthenticated,
  validate({
    params: milestoneParamsSchema,
    query: roleOnlyQuerySchema,
    body: milestoneCheckoutBodySchema,
    responses: contractsResponses.milestoneCheckout,
  }),
  startMilestoneFundingCheckout,
);
contractsRouter.post(
  "/:contractId/milestones",
  isAuthenticated,
  validate({
    params: contractIdParamsSchema,
    query: roleOnlyQuerySchema,
    body: addMilestoneBodySchema,
    responses: contractsResponses.addMilestone,
  }),
  createAdditionalMilestone,
);
contractsRouter.post(
  "/:contractId/finish",
  isAuthenticated,
  validate({
    params: contractIdParamsSchema,
    query: scopeQuerySchema,
    body: finishContractBodySchema,
    responses: contractsResponses.finish,
  }),
  finishContract,
);
