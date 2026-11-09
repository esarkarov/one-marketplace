import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
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

export const freelancerRouter = Router();

freelancerRouter.get("/profile", isAuthenticated, getLoggedInFreelancerProfile);
freelancerRouter.get("/search", searchPublicFreelancersHandler);
freelancerRouter.get("/profile/:id", getPublicFreelancer);
freelancerRouter.put("/profile", isAuthenticated, upsertFreelanceProfile);
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
freelancerRouter.get("/jobs", isAuthenticated, getFreelancerJobFeed);
freelancerRouter.get("/jobs/:id", isAuthenticated, getFreelancerJobDetails);
