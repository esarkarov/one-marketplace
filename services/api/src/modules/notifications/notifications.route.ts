import { Router } from "express";
import { isAuthenticated } from "../../middleware/auth.middleware.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationStream,
} from "./notifications.controller.js";

export const notificationRouter = Router();

notificationRouter.use(isAuthenticated);
notificationRouter.get("/", listNotifications);
notificationRouter.patch("/read-all", markAllNotificationsRead);
notificationRouter.patch("/:notificationId/read", markNotificationRead);
notificationRouter.get("/stream", notificationStream);
