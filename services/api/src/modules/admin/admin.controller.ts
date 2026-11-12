import { timingSafeEqual } from "crypto";
import { RequestHandler } from "express";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { ApiError } from "../../shared/http/api-error.js";
import { env } from "../../config/env.js";
import {
  getAdminAccounts,
  getAdminContracts,
  getAdminJobPosts,
  getAdminOverviewActivity,
  getAdminOverviewTotals,
  getAdminProposals,
  getAdminTransactions,
  getRedisKeyValue,
  getSystemHealth,
  Pagination,
  scanRedisKeys,
} from "./admin.service.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const parsePagination = (
  request: Parameters<RequestHandler>[0],
): Pagination => {
  const rawLimit = Number(request.query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const rawOffset = Number(request.query.offset);
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
};

const passwordsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

export const loginAdminHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!env.adminDashboardPassword) {
      throw new ApiError(503, "Admin authentication is not configured.");
    }

    const password =
      typeof request.body?.password === "string" ? request.body.password : "";

    if (!passwordsMatch(password, env.adminDashboardPassword)) {
      await request.logger.warn({
        message: "Admin sign-in failed",
        eventName: "auth.login.failed",
        attributes: {
          "auth.method": "password",
          "auth.failure_kind": "invalid_credentials",
          "client.address": request.ip ?? "unknown",
        },
      });
      throw new ApiError(401, "Incorrect password.");
    }

    await request.logger.info({
      message: "Admin signed in",
      eventName: "auth.login.succeeded",
      attributes: {
        "auth.method": "password",
        "client.address": request.ip ?? "unknown",
      },
    });

    response.status(200).json({ success: true, message: "Password verified." });
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
    const data = await getAdminOverviewActivity(parsePagination(request));
    response.status(200).json({
      success: true,
      message: "Recent activity retrieved.",
      data,
    });
  },
);

export const getAccountsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getAdminAccounts(parsePagination(request));
    response
      .status(200)
      .json({ success: true, message: "Accounts retrieved.", data });
  },
);

export const getJobPostsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getAdminJobPosts(parsePagination(request));
    response
      .status(200)
      .json({ success: true, message: "Job posts retrieved.", data });
  },
);

export const getProposalsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getAdminProposals(parsePagination(request));
    response
      .status(200)
      .json({ success: true, message: "Proposals retrieved.", data });
  },
);

export const getContractsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getAdminContracts(parsePagination(request));
    response
      .status(200)
      .json({ success: true, message: "Contracts retrieved.", data });
  },
);

export const getTransactionsHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getAdminTransactions(parsePagination(request));
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
    const data = await scanRedisKeys(String(request.query.pattern));
    response
      .status(200)
      .json({ success: true, message: "Redis keys scanned.", data });
  },
);

export const getRedisKeyHandler: RequestHandler = asyncHandler(
  async (request, response) => {
    const data = await getRedisKeyValue(String(request.params.key));
    response
      .status(200)
      .json({ success: true, message: "Redis key retrieved.", data });
  },
);

export const streamLogsHandler: RequestHandler = asyncHandler(async () => {
  throw new ApiError(503, "Logging is not configured.");
});
