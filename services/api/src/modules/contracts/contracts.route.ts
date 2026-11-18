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
  addMilestoneBodySchema,
  contractCheckoutBodySchema,
  contractIdParamsSchema,
  finishContractBodySchema,
  milestoneCheckoutBodySchema,
  milestoneParamsSchema,
  reviewMilestoneBodySchema,
  roleOnlyQuerySchema,
  scopeQuerySchema,
  freelancerContractsQuerySchema,
  submitMilestoneBodySchema,
} from "./schemas/contracts.schema.js";
import { roleListQuerySchema } from "../../shared/validation/schemas/pagination.schema.js";
import { contractsResponses } from "./responses/contracts.responses.js";

export const contractsRouter = Router();

contractsRouter.post("/webhook", contractWebhook);
contractsRouter.get(
  "/client",
  isAuthenticated,
  validate({
    query: roleListQuerySchema,
    responses: contractsResponses.client,
  }),
  getClientContracts,
);
contractsRouter.get(
  "/freelancer",
  isAuthenticated,
  validate({
    query: freelancerContractsQuerySchema,
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
  "/:contractId/decline",
  isAuthenticated,
  validate({
    params: contractIdParamsSchema,
    query: scopeQuerySchema,
    responses: contractsResponses.decline,
  }),
  declineContractOffer,
);
contractsRouter.patch(
  "/:contractId/withdraw",
  isAuthenticated,
  validate({
    params: contractIdParamsSchema,
    query: roleOnlyQuerySchema,
    responses: contractsResponses.withdraw,
  }),
  withdrawContractOffer,
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
