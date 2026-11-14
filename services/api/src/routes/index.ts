import { Router } from "express";
import { agencyRouter } from "../modules/agency/agency.route.js";
import { authRouter } from "../modules/auth/auth.route.js";
import { clientRouter } from "../modules/client/client.route.js";
import { freelancerRouter } from "../modules/freelancer/freelancer.route.js";
import { jobRouter } from "../modules/jobs/jobs.route.js";
import { connectsRouter } from "../modules/connects/connects.route.js";
import { notificationRouter } from "../modules/notifications/notifications.route.js";
import {
  agencyProposalsRouter,
  proposalRouter,
} from "../modules/proposals/proposals.route.js";
import { messagingRouter } from "../modules/messaging/messaging.route.js";
import { contractsRouter } from "../modules/contracts/contracts.route.js";
import { identityRouter } from "../modules/identity/identity.route.js";
import {
  conversationMeetingsRouter,
  meetingsRouter,
} from "../modules/meetings/meetings.route.js";
import { adminRouter } from "../modules/admin/admin.route.js";
import {
  healthRouter,
  readinessRouter,
} from "../modules/health/health.route.js";

export {
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "../modules/auth/index.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/client", clientRouter);
apiRouter.use("/freelancer", freelancerRouter);
apiRouter.use("/jobs", jobRouter);
apiRouter.use("/connects", connectsRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/proposals", proposalRouter);
apiRouter.use("/conversations", messagingRouter);
apiRouter.use("/conversations", conversationMeetingsRouter);
apiRouter.use("/contracts", contractsRouter);
apiRouter.use("/identity", identityRouter);
apiRouter.use("/agency", agencyProposalsRouter);
apiRouter.use("/agency", agencyRouter);
apiRouter.use("/meetings", meetingsRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/health", healthRouter);
apiRouter.use("/ready", readinessRouter);
