import { Router } from "express";
import { isAuthenticated } from "../auth/index.js";
import { validate } from "../../middleware/validate/validate.middleware.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationStream,
} from "./controllers/notifications.controller.js";
import {
  notificationIdParamsSchema,
  roleOnlyQuerySchema,
  scopeQuerySchema,
} from "./schemas/notifications.schema.js";
import { notificationsResponses } from "./responses/notifications.responses.js";

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
