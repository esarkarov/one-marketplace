import { Router } from "express";
import {
  getAccountsHandler,
  getContractsHandler,
  getJobPostsHandler,
  getOverviewActivityHandler,
  getOverviewHandler,
  getProposalsHandler,
  getRedisKeyHandler,
  getSystemHealthHandler,
  getTransactionsHandler,
  loginAdminHandler,
  scanRedisKeysHandler,
  streamLogsHandler,
} from "./admin.controller.js";
import { validate } from "../../shared/http/validate.middleware.js";
import {
  adminListQuerySchema,
  adminLogStreamQuerySchema,
  adminLoginBodySchema,
} from "./admin.schemas.js";
import { adminResponses } from "./admin.responses.js";
import { redisKeyParamsSchema, redisScanQuerySchema } from "./admin-redis.js";
import {
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
} from "../../shared/http/auth/admin-session.middleware.js";
import {
  adminLimiter,
  adminLoginLimiter,
} from "../../shared/http/limits/rate-limit.middleware.js";

export const adminRouter = Router();

adminRouter.post(
  "/auth/login",
  adminLoginLimiter,
  validate({
    body: adminLoginBodySchema,
    query: {},
    responses: adminResponses.login,
  }),
  loginAdminHandler,
);

adminRouter.use(adminLimiter);
adminRouter.get(
  "/logs/stream",
  requireAdminSessionAllowingQueryToken,
  validate({
    query: adminLogStreamQuerySchema,
    responses: adminResponses.logsStream,
  }),
  streamLogsHandler,
);
adminRouter.use(requireAdminSession);
adminRouter.get(
  "/overview",
  validate({ query: {}, responses: adminResponses.overview }),
  getOverviewHandler,
);
adminRouter.get(
  "/overview/activity",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.activity,
  }),
  getOverviewActivityHandler,
);
adminRouter.get(
  "/accounts",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.accounts,
  }),
  getAccountsHandler,
);
adminRouter.get(
  "/job-posts",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.jobPosts,
  }),
  getJobPostsHandler,
);
adminRouter.get(
  "/proposals",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.proposals,
  }),
  getProposalsHandler,
);
adminRouter.get(
  "/contracts",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.contracts,
  }),
  getContractsHandler,
);
adminRouter.get(
  "/transactions",
  validate({
    query: adminListQuerySchema,
    responses: adminResponses.transactions,
  }),
  getTransactionsHandler,
);
adminRouter.get(
  "/system/health",
  validate({ query: {}, responses: adminResponses.systemHealth }),
  getSystemHealthHandler,
);
adminRouter.get(
  "/system/redis/keys",
  validate({
    query: redisScanQuerySchema,
    responses: adminResponses.redisKeys,
  }),
  scanRedisKeysHandler,
);
adminRouter.get(
  "/system/redis/keys/:key",
  validate({
    params: redisKeyParamsSchema,
    query: {},
    responses: adminResponses.redisKey,
  }),
  getRedisKeyHandler,
);
