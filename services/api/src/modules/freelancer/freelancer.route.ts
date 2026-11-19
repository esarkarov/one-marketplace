import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../auth/index.js";
import { largeJsonBody } from "../../middleware/json-body/json-body.middleware.js";
import { publicSearchLimiter } from "../../middleware/rate-limit/rate-limit.middleware.js";
import { contentWriteLimiter } from "../../middleware/rate-limit/user-rate-limit.middleware.js";
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
} from "./controllers/freelancer.controller.js";

import { validate } from "../../middleware/validate/validate.middleware.js";
import { authRoleShape } from "../../shared/validation/schemas/common.schema.js";
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
} from "./responses/freelancer.responses.js";
import {
  freelancerJobDetailsRequest,
  jobFeedRequest,
  publicFreelancerRequest,
  talentSearchRequest,
  upsertProfileRequest,
} from "./schemas/freelancer.schema.js";

export const freelancerRouter = Router();

const profileWriteLimiter = contentWriteLimiter("freelancer-profile-write");

freelancerRouter.get(
  "/profile",
  isAuthenticated,
  validate({ query: authRoleShape, responses: freelancerProfileGetResponses }),
  getLoggedInFreelancerProfile,
);
freelancerRouter.get(
  "/search",
  publicSearchLimiter,
  validate({ ...talentSearchRequest, responses: freelancerSearchResponses }),
  searchPublicFreelancersHandler,
);
freelancerRouter.get(
  "/profile/:id",
  validate({
    ...publicFreelancerRequest,
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
    ...upsertProfileRequest,
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
  validate({ ...jobFeedRequest, responses: freelancerJobFeedResponses }),
  getFreelancerJobFeed,
);
freelancerRouter.get(
  "/jobs/:id",
  isAuthenticated,
  validate({
    ...freelancerJobDetailsRequest,
    responses: freelancerJobDetailResponses,
  }),
  getFreelancerJobDetails,
);
