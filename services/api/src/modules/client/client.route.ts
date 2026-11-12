import { Router } from "express";
import { isAuthenticated } from "../../shared/http/auth.middleware.js";
import { validate } from "../../shared/http/validate.middleware.js";
import { authRoleShape } from "../../shared/validation/common-schemas.js";
import {
  clientProfileBodySchema,
  marketplaceSearchQuerySchema,
} from "./client.schemas.js";
import {
  clientCompletedContractsResponses,
  clientDashboardOverviewResponses,
  clientFinanceLinkResponses,
  clientHiringOverviewResponses,
  clientMarketplaceSearchResponses,
  clientProfileGetResponses,
  clientProfilePutResponses,
} from "./client.responses.js";
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
  validate({ query: authRoleShape, responses: clientProfileGetResponses }),
  getLoggedInClientProfile,
);
clientRouter.put(
  "/profile",
  isAuthenticated,
  validate({
    query: authRoleShape,
    body: clientProfileBodySchema,
    responses: clientProfilePutResponses,
  }),
  upsertClientProfile,
);
clientRouter.get(
  "/hiring-overview",
  isAuthenticated,
  validate({ query: authRoleShape, responses: clientHiringOverviewResponses }),
  getClientHiringOverviewHandler,
);
clientRouter.get(
  "/completed-contracts",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: clientCompletedContractsResponses,
  }),
  getClientCompletedContractsHandler,
);
clientRouter.get(
  "/dashboard-overview",
  isAuthenticated,
  validate({
    query: authRoleShape,
    responses: clientDashboardOverviewResponses,
  }),
  getClientDashboardOverviewHandler,
);
clientRouter.get(
  "/finances/manage-link",
  isAuthenticated,
  validate({ query: authRoleShape, responses: clientFinanceLinkResponses }),
  getClientFinanceManagementLink,
);
clientRouter.get(
  "/marketplace/search",
  isAuthenticated,
  validate({
    query: marketplaceSearchQuerySchema,
    responses: clientMarketplaceSearchResponses,
  }),
  searchMarketplaceHandler,
);
