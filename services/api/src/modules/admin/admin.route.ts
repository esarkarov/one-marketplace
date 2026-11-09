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
import { requireAdminSession } from "./admin-session.middleware.js";

export const adminRouter = Router();

adminRouter.post("/auth/login", loginAdminHandler);

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
adminRouter.get("/system/redis/keys", scanRedisKeysHandler);
adminRouter.get("/system/redis/keys/:key", getRedisKeyHandler);
