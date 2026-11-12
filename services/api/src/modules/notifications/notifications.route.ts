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
import { notificationsResponses } from "./notifications.responses.js";

export const notificationRouter = Router();

notificationRouter.use(isAuthenticated);
notificationRouter.get(
  "/",
  validate({
    query: scopeQuerySchema,
    responses: notificationsResponses.list,
  }),
  listNotifications,
);
notificationRouter.patch(
  "/read-all",
  validate({
    query: scopeQuerySchema,
    responses: notificationsResponses.readAll,
  }),
  markAllNotificationsRead,
);
notificationRouter.patch(
  "/:notificationId/read",
  validate({
    params: notificationIdParamsSchema,
    query: roleOnlyQuerySchema,
    responses: notificationsResponses.read,
  }),
  markNotificationRead,
);
notificationRouter.get(
  "/stream",
  validate({ query: scopeQuerySchema }),
  notificationStream,
);
