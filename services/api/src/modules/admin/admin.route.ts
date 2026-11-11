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
import { validate } from "../../middleware/validate.middleware.js";
import {
  adminListQuerySchema,
  adminLogStreamQuerySchema,
  adminLoginBodySchema,
} from "./admin.schemas.js";
import { redisKeyParamsSchema, redisScanQuerySchema } from "./admin-redis.js";
import {
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
} from "./admin-session.middleware.js";
import {
  adminLimiter,
  adminLoginLimiter,
} from "../../middleware/rate-limit.middleware.js";

export const adminRouter = Router();

adminRouter.post(
  "/auth/login",
  adminLoginLimiter,
  validate({ body: adminLoginBodySchema, query: {} }),
  loginAdminHandler,
);

adminRouter.use(adminLimiter);
adminRouter.get(
  "/logs/stream",
  requireAdminSessionAllowingQueryToken,
  validate({ query: adminLogStreamQuerySchema }),
  streamLogsHandler,
);
adminRouter.use(requireAdminSession);
adminRouter.get("/overview", validate({ query: {} }), getOverviewHandler);
adminRouter.get(
  "/overview/activity",
  validate({ query: adminListQuerySchema }),
  getOverviewActivityHandler,
);
adminRouter.get(
  "/accounts",
  validate({ query: adminListQuerySchema }),
  getAccountsHandler,
);
adminRouter.get(
  "/job-posts",
  validate({ query: adminListQuerySchema }),
  getJobPostsHandler,
);
adminRouter.get(
  "/proposals",
  validate({ query: adminListQuerySchema }),
  getProposalsHandler,
);
adminRouter.get(
  "/contracts",
  validate({ query: adminListQuerySchema }),
  getContractsHandler,
);
adminRouter.get(
  "/transactions",
  validate({ query: adminListQuerySchema }),
  getTransactionsHandler,
);
adminRouter.get(
  "/system/health",
  validate({ query: {} }),
  getSystemHealthHandler,
);
adminRouter.get(
  "/system/redis/keys",
  validate({ query: redisScanQuerySchema }),
  scanRedisKeysHandler,
);
adminRouter.get(
  "/system/redis/keys/:key",
  validate({ params: redisKeyParamsSchema, query: {} }),
  getRedisKeyHandler,
);
