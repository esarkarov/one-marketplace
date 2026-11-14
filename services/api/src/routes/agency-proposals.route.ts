import { Router } from "express";
import { isAuthenticated } from "../modules/auth/auth.public.js";
import { validate } from "../shared/http/validate.middleware.js";
import { authRoleShape } from "../shared/validation/common-schemas.js";
import { submitProposalBodySchema } from "../shared/validation/money-schemas.js";
import {
  agencyProposalMetadataResponses,
  agencyProposalsResponses,
  agencySubmitProposalResponses,
} from "../modules/agency/agency.responses.js";
import {
  getAgencyProposalMetadataHandler,
  getAgencyProposalsHandler,
  submitAgencyProposalHandler,
} from "../modules/proposals/proposals.controller.js";

export const agencyProposalsRouter = Router();

agencyProposalsRouter.get(
  "/proposals",
  isAuthenticated,
  validate({ query: authRoleShape, responses: agencyProposalsResponses }),
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
    query: authRoleShape,
    responses: agencyProposalMetadataResponses,
  }),
  getAgencyProposalMetadataHandler,
);
