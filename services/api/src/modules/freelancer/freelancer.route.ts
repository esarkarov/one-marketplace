import { Router } from "express";
import {
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "../../middleware/auth.middleware.js";
import { largeJsonBody } from "../../middleware/json-body.middleware.js";
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
import {
  jobFeedQuerySchema,
  talentSearchQuerySchema,
  upsertProfileBodySchema,
} from "./freelancer.schemas.js";

export const freelancerRouter = Router();

const profileWriteLimiter = contentWriteLimiter();

freelancerRouter.get("/profile", isAuthenticated, getLoggedInFreelancerProfile);
freelancerRouter.get(
  "/search",
  validate({ query: talentSearchQuerySchema }),
  searchPublicFreelancersHandler,
);
freelancerRouter.get("/profile/:id", getPublicFreelancer);
freelancerRouter.put(
  "/profile",
  verifyBearerToken,
  profileWriteLimiter,
  largeJsonBody,
  resolveAccountRole,
  validate({ body: upsertProfileBodySchema }),
  upsertFreelanceProfile,
);
freelancerRouter.get(
  "/earnings/summary",
  isAuthenticated,
  getFreelancerEarningsSummary,
);
freelancerRouter.get(
  "/earnings/overview",
  isAuthenticated,
  getFreelancerEarningsOverviewHandler,
);
freelancerRouter.get(
  "/earnings/certificate",
  isAuthenticated,
  getFreelancerEarningsCertificate,
);
freelancerRouter.get(
  "/payouts/connect-link",
  isAuthenticated,
  getFreelancerPayoutManagementLink,
);
freelancerRouter.get(
  "/jobs",
  isAuthenticated,
  validate({ query: jobFeedQuerySchema }),
  getFreelancerJobFeed,
);
freelancerRouter.get("/jobs/:id", isAuthenticated, getFreelancerJobDetails);
