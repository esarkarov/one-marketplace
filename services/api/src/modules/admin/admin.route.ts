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
import { redisKeyParamsSchema, redisScanQuerySchema } from "./admin-redis.js";
import { requireAdminSession } from "./admin-session.middleware.js";
import {
  adminLimiter,
  adminLoginLimiter,
} from "../../middleware/rate-limit.middleware.js";

export const adminRouter = Router();

adminRouter.post("/auth/login", adminLoginLimiter, loginAdminHandler);

adminRouter.use(adminLimiter);
adminRouter.use(requireAdminSession);
adminRouter.get("/overview", getOverviewHandler);
adminRouter.get("/overview/activity", getOverviewActivityHandler);
adminRouter.get("/accounts", getAccountsHandler);
adminRouter.get("/job-posts", getJobPostsHandler);
adminRouter.get("/proposals", getProposalsHandler);
adminRouter.get("/contracts", getContractsHandler);
adminRouter.get("/transactions", getTransactionsHandler);
adminRouter.get("/logs/stream", streamLogsHandler);
adminRouter.get("/system/health", getSystemHealthHandler);
adminRouter.get(
  "/system/redis/keys",
  validate({ query: redisScanQuerySchema }),
  scanRedisKeysHandler,
);
adminRouter.get(
  "/system/redis/keys/:key",
  validate({ params: redisKeyParamsSchema }),
  getRedisKeyHandler,
);
