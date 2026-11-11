import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { authRoleShape } from "../../utils/common-schemas.js";
import {
  clientProfileBodySchema,
  marketplaceSearchQuerySchema,
} from "./client.schemas.js";
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

clientRouter.get(
  "/profile",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getLoggedInClientProfile,
);
clientRouter.put(
  "/profile",
  isAuthenticated,
  validate({ query: authRoleShape, body: clientProfileBodySchema }),
  upsertClientProfile,
);
clientRouter.get(
  "/hiring-overview",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getClientHiringOverviewHandler,
);
clientRouter.get(
  "/completed-contracts",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getClientCompletedContractsHandler,
);
clientRouter.get(
  "/dashboard-overview",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getClientDashboardOverviewHandler,
);
clientRouter.get(
  "/finances/manage-link",
  isAuthenticated,
  validate({ query: authRoleShape }),
  getClientFinanceManagementLink,
);
clientRouter.get(
  "/marketplace/search",
  isAuthenticated,
  validate({ query: marketplaceSearchQuerySchema }),
  searchMarketplaceHandler,
);
