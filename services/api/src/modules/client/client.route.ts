import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import {
  getClientCompletedContractsHandler,
  getClientDashboardOverviewHandler,
  getClientFinanceManagementLink,
  getClientHiringOverviewHandler,
  getLoggedInClientProfile,
  searchMarketplaceHandler,
  upsertClientProfile,
} from "./client.controller.js";

export const clientRouter = Router();

clientRouter.get("/profile", isAuthenticated, getLoggedInClientProfile);
clientRouter.put("/profile", isAuthenticated, upsertClientProfile);
clientRouter.get(
  "/hiring-overview",
  isAuthenticated,
  getClientHiringOverviewHandler,
);
clientRouter.get(
  "/completed-contracts",
  isAuthenticated,
  getClientCompletedContractsHandler,
);
clientRouter.get(
  "/dashboard-overview",
  isAuthenticated,
  getClientDashboardOverviewHandler,
);
clientRouter.get(
  "/finances/manage-link",
  isAuthenticated,
  getClientFinanceManagementLink,
);
clientRouter.get(
  "/marketplace/search",
  isAuthenticated,
  searchMarketplaceHandler,
);
