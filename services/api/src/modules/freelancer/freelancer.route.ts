import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
import { publicSearchLimiter } from "../../middleware/rate-limit.middleware.js";
import { contentWriteLimiter } from "../../middleware/user-rate-limit.middleware.js";
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

import { validate } from "../../middleware/validate.middleware.js";
import { authRoleShape } from "../../utils/common-schemas.js";
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
  validate({ query: authRoleShape }),
  getLoggedInFreelancerProfile,
);
freelancerRouter.get(
  "/search",
  publicSearchLimiter,
  validate({ query: talentSearchQuerySchema }),
  searchPublicFreelancersHandler,
);
freelancerRouter.get(
  "/profile/:id",
  validate({ params: idParamsSchema, query: {} }),
  getPublicFreelancer,
);
freelancerRouter.put(
  "/profile",
  verifyBearerToken,
  profileWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ body: upsertProfileBodySchema, query: authRoleShape }),
  upsertFreelanceProfile,
);
freelancerRouter.get(
  "/earnings/summary",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getFreelancerEarningsSummary,
);
freelancerRouter.get(
  "/earnings/overview",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getFreelancerEarningsOverviewHandler,
);
freelancerRouter.get(
  "/earnings/certificate",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getFreelancerEarningsCertificate,
);
freelancerRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getFreelancerPayoutManagementLink,
);
freelancerRouter.get(
  "/jobs",
  isAuthenticated,
  validate({ query: jobFeedQuerySchema }),
  getFreelancerJobFeed,
);
freelancerRouter.get(
  "/jobs/:id",
  isAuthenticated,
  validate({ params: idParamsSchema, query: authRoleShape }),
  getFreelancerJobDetails,
);
