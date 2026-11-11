import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationStream,
} from "./notifications.controller.js";
import {
  notificationIdParamsSchema,
  roleOnlyQuerySchema,
  scopeQuerySchema,
} from "./notifications.schemas.js";

export const notificationRouter = Router();

notificationRouter.use(isAuthenticated);
notificationRouter.get(
  "/",
  validate({ query: scopeQuerySchema }),
  listNotifications,
);
notificationRouter.patch(
  "/read-all",
  validate({ query: scopeQuerySchema }),
  markAllNotificationsRead,
);
notificationRouter.patch(
  "/:notificationId/read",
  validate({ params: notificationIdParamsSchema, query: roleOnlyQuerySchema }),
  markNotificationRead,
);
notificationRouter.get(
  "/stream",
  validate({ query: scopeQuerySchema }),
  notificationStream,
);
