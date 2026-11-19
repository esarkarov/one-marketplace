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
} from "./controllers/admin.controller.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  adminListRequest,
  adminLoginRequest,
  adminLogStreamQuerySchema,
  adminRedisKeyRequest,
  adminRedisScanRequest,
} from "./schemas/admin.schema.js";
import { adminResponses } from "./responses/admin.responses.js";
import {
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
} from "../../middleware/auth/admin-session.middleware.js";
import {
  adminLimiter,
  adminLoginLimiter,
} from "../../middleware/rate-limit/rate-limit.middleware.js";

export const adminRouter = Router();

adminRouter.post(
  "/auth/login",
  adminLoginLimiter,
  validate({ ...adminLoginRequest, responses: adminResponses.login }),
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
  validate({ ...adminListRequest, responses: adminResponses.activity }),
  getOverviewActivityHandler,
);
adminRouter.get(
  "/accounts",
  validate({ ...adminListRequest, responses: adminResponses.accounts }),
  getAccountsHandler,
);
adminRouter.get(
  "/job-posts",
  validate({ ...adminListRequest, responses: adminResponses.jobPosts }),
  getJobPostsHandler,
);
adminRouter.get(
  "/proposals",
  validate({ ...adminListRequest, responses: adminResponses.proposals }),
  getProposalsHandler,
);
adminRouter.get(
  "/contracts",
  validate({ ...adminListRequest, responses: adminResponses.contracts }),
  getContractsHandler,
);
adminRouter.get(
  "/transactions",
  validate({ ...adminListRequest, responses: adminResponses.transactions }),
  getTransactionsHandler,
);
adminRouter.get(
  "/system/health",
  validate({ query: {}, responses: adminResponses.systemHealth }),
  getSystemHealthHandler,
);
adminRouter.get(
  "/system/redis/keys",
  validate({ ...adminRedisScanRequest, responses: adminResponses.redisKeys }),
  scanRedisKeysHandler,
);
adminRouter.get(
  "/system/redis/keys/:key",
  validate({ ...adminRedisKeyRequest, responses: adminResponses.redisKey }),
  getRedisKeyHandler,
);
