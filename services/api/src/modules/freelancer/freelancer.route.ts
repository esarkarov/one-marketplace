import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../shared/http/auth.middleware.js";
import { largeJsonBody } from "../../shared/http/json-body.middleware.js";
import { publicSearchLimiter } from "../../shared/http/rate-limit.middleware.js";
import { contentWriteLimiter } from "../../shared/http/user-rate-limit.middleware.js";
import {
  getFreelancerEarningsCertificate,
  getFreelancerEarningsOverviewHandler,
  getFreelancerEarningsSummary,
  getFreelancerJobDetails,
  getFreelancerJobFeed,
  getFreelancerPayoutManagementLink,
  getLoggedInFreelancerProfile,
  getPublicFreelancer,
  searchPublicFreelancersHandler,
  upsertFreelanceProfile,
} from "./freelancer.controller.js";

import { validate } from "../../shared/http/validate.middleware.js";
import { authRoleShape } from "../../shared/validation/common-schemas.js";
import {
  freelancerEarningsCertificateResponses,
  freelancerEarningsOverviewResponses,
  freelancerEarningsSummaryResponses,
  freelancerJobDetailResponses,
  freelancerJobFeedResponses,
  freelancerPayoutLinkResponses,
  freelancerProfileGetResponses,
  freelancerProfilePutResponses,
  freelancerPublicProfileResponses,
  freelancerSearchResponses,
} from "./freelancer.responses.js";
import {
  idParamsSchema,
  jobFeedQuerySchema,
  talentSearchQuerySchema,
  upsertProfileBodySchema,
} from "./freelancer.schemas.js";

export const freelancerRouter = Router();

const profileWriteLimiter = contentWriteLimiter();

freelancerRouter.get(
  "/profile",
  isAuthenticated,
  validate({ query: authRoleShape, responses: freelancerProfileGetResponses }),
  getLoggedInFreelancerProfile,
);
freelancerRouter.get(
  "/search",
  publicSearchLimiter,
  validate({
    query: talentSearchQuerySchema,
    responses: freelancerSearchResponses,
  }),
  searchPublicFreelancersHandler,
);
freelancerRouter.get(
  "/profile/:id",
  validate({
    params: idParamsSchema,
    query: {},
    responses: freelancerPublicProfileResponses,
  }),
  getPublicFreelancer,
);
freelancerRouter.put(
  "/profile",
  verifyBearerToken,
  profileWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({
    body: upsertProfileBodySchema,
    query: authRoleShape,
    responses: freelancerProfilePutResponses,
  }),
  upsertFreelanceProfile,
);
freelancerRouter.get(
  "/earnings/summary",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: freelancerEarningsSummaryResponses,
  }),
  getFreelancerEarningsSummary,
);
freelancerRouter.get(
  "/earnings/overview",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: freelancerEarningsOverviewResponses,
  }),
  getFreelancerEarningsOverviewHandler,
);
freelancerRouter.get(
  "/earnings/certificate",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: freelancerEarningsCertificateResponses,
  }),
  getFreelancerEarningsCertificate,
);
freelancerRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: freelancerPayoutLinkResponses,
  }),
  getFreelancerPayoutManagementLink,
);
freelancerRouter.get(
  "/jobs",
  isAuthenticated,
  validate({
    query: jobFeedQuerySchema,
    responses: freelancerJobFeedResponses,
  }),
  getFreelancerJobFeed,
);
freelancerRouter.get(
  "/jobs/:id",
  isAuthenticated,
  validate({
    params: idParamsSchema,
    query: authRoleShape,
    responses: freelancerJobDetailResponses,
  }),
  getFreelancerJobDetails,
);
