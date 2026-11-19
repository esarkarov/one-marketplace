import { RequestHandler } from "express";
import { asyncHandler } from "../../../middleware/utils/async-handler.utils.js";
import { getValidated } from "../../../middleware/utils/validated-request.utils.js";
import { ApiError } from "../../../shared/errors/api-error.js";
import { loginAdmin } from "../services/admin.auth.service.js";
import {
  getAdminAccounts,
  getAdminContracts,
  getAdminJobPosts,
  getAdminProposals,
  getAdminTransactions,
} from "../services/admin.listings.service.js";
import {
  getAdminOverviewActivity,
  getAdminOverviewTotals,
} from "../services/admin.overview.service.js";
import {
  getRedisKeyValue,
  getSystemHealth,
  scanRedisKeys,
} from "../services/admin.system.service.js";
import {
  adminListRequest,
  adminLoginRequest,
  adminRedisKeyRequest,
  adminRedisScanRequest,
} from "../schemas/admin.schema.js";
import { Pagination } from "../types/admin.types.js";

const parsePagination = (query: Pagination): Pagination => ({
  limit: query.limit,
  offset: query.offset,
});

export const loginAdminHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { body } = getValidated(request, adminLoginRequest);
    const { token, expiresAt } = await loginAdmin(
      body.password,
      request.ip,
      request.logger,
    );

    response.status(200).json({
      success: true,
      message: "Password verified.",
      data: { token, expiresAt: new Date(expiresAt).toISOString() },
    });
  },
);

export const getOverviewHandler: RequestHandler = asyncHandler(
  async (_request, response) => {
    const data = await getAdminOverviewTotals();
    response.status(200).json({
      success: true,
      message: "Platform overview retrieved.",
      data,
    });
  },
);

export const getOverviewActivityHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminOverviewActivity(parsePagination(query));
    response.status(200).json({
      success: true,
      message: "Recent activity retrieved.",
      data,
    });
  },
);

export const getAccountsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminAccounts(parsePagination(query));
    response
      .status(200)
      .json({ success: true, message: "Accounts retrieved.", data });
  },
);

export const getJobPostsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminJobPosts(parsePagination(query));
    response
      .status(200)
      .json({ success: true, message: "Job posts retrieved.", data });
  },
);

export const getProposalsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminProposals(parsePagination(query));
    response
      .status(200)
      .json({ success: true, message: "Proposals retrieved.", data });
  },
);

export const getContractsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminContracts(parsePagination(query));
    response
      .status(200)
      .json({ success: true, message: "Contracts retrieved.", data });
  },
);

export const getTransactionsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminListRequest);
    const data = await getAdminTransactions(parsePagination(query));
    response
      .status(200)
      .json({ success: true, message: "Transactions retrieved.", data });
  },
);

export const getSystemHealthHandler: RequestHandler = asyncHandler(
  async (_request, response) => {
    const data = await getSystemHealth();
    response
      .status(200)
      .json({ success: true, message: "System health retrieved.", data });
  },
);

export const scanRedisKeysHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, adminRedisScanRequest);
    const data = await scanRedisKeys(query.pattern);
    response
      .status(200)
      .json({ success: true, message: "Redis keys scanned.", data });
  },
);

export const getRedisKeyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const { params } = getValidated(request, adminRedisKeyRequest);
    const data = await getRedisKeyValue(params.key);
    response
      .status(200)
      .json({ success: true, message: "Redis key retrieved.", data });
  },
);

export const streamLogsHandler: RequestHandler = asyncHandler(async () => {
  throw new ApiError(503, "Logging is not configured.");
});
