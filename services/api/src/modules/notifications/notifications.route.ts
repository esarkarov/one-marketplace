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
  listNotificationsRequest,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
  notificationStreamRequest,
} from "./schemas/notifications.schema.js";
import { notificationsResponses } from "./responses/notifications.responses.js";

export const notificationRouter = Router();

notificationRouter.use(isAuthenticated);
notificationRouter.get(
  "/",
  validate({
    ...listNotificationsRequest,
    responses: notificationsResponses.list,
  }),
  listNotifications,
);
notificationRouter.patch(
  "/read-all",
  validate({
    ...markAllNotificationsReadRequest,
    responses: notificationsResponses.readAll,
  }),
  markAllNotificationsRead,
);
notificationRouter.patch(
  "/:notificationId/read",
  validate({
    ...markNotificationReadRequest,
    responses: notificationsResponses.read,
  }),
  markNotificationRead,
);
notificationRouter.get(
  "/stream",
  validate({ ...notificationStreamRequest }),
  notificationStream,
);
