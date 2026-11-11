import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
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

export const contractsRouter = Router();

contractsRouter.post("/webhook", contractWebhook);
contractsRouter.get(
  "/client",
  isAuthenticated,
  validate({ query: roleOnlyQuerySchema }),
  getClientContracts,
);
contractsRouter.get(
  "/freelancer",
  isAuthenticated,
  validate({ query: scopeQuerySchema }),
  getFreelancerContracts,
);
contractsRouter.patch(
  "/:contractId/accept",
  isAuthenticated,
  validate({ params: contractIdParamsSchema, query: scopeQuerySchema }),
  acceptContractOffer,
);
contractsRouter.patch(
  "/:contractId/milestones/:milestoneId/submit",
  isAuthenticated,
  validate({
    params: milestoneParamsSchema,
    query: scopeQuerySchema,
    body: submitMilestoneBodySchema,
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
  }),
  reviewMilestoneWork,
);
contractsRouter.post(
  "/checkout",
  isAuthenticated,
  validate({ query: roleOnlyQuerySchema, body: contractCheckoutBodySchema }),
  startContractCheckout,
);
contractsRouter.post(
  "/:contractId/milestones/:milestoneId/checkout",
  isAuthenticated,
  validate({
    params: milestoneParamsSchema,
    query: roleOnlyQuerySchema,
    body: milestoneCheckoutBodySchema,
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
  }),
  finishContract,
);
