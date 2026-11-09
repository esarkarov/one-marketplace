import { RequestHandler } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { ApiResponse } from "../../types/common.types.js";
import {
  getNotifications,
  readAllNotifications,
  readNotification,
} from "./notifications.service.js";
import { getAgencyIdForMember } from "../agency/agency.service.js";
import {
  addAgencyNotificationClient,
  addNotificationClient,
} from "./notification.sse.js";
import { ApiError } from "../../utils/api-error.js";

type Scope = "agency" | "default";

const requestedScope = (value: unknown): Scope =>
  value === "agency" ? "agency" : "default";

const resolveScopeAgencyId = async (userId: string, scope: Scope) =>
  scope === "agency" ? getAgencyIdForMember(userId) : null;

const requireNotificationId = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(400, "Notification is invalid.");
  }
  return value;
};

export const listNotifications: RequestHandler = asyncHandler(
  async (request, response) => {
    const scope = requestedScope(request.query.scope);
    const agencyId = await resolveScopeAgencyId(request.auth!.userId, scope);

    const data =
      scope === "agency" && !agencyId
        ? []
        : await getNotifications(request.auth!.userId, agencyId);

    response.json({
      success: true,
      message: "Notifications retrieved.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const markAllNotificationsRead: RequestHandler = asyncHandler(
  async (request, response) => {
    const scope = requestedScope(request.query.scope);
    const agencyId = await resolveScopeAgencyId(request.auth!.userId, scope);

    if (scope !== "agency" || agencyId) {
      await readAllNotifications(request.auth!.userId, agencyId);
    }

    response.json({
      success: true,
      message: "Notifications marked as read.",
    } satisfies ApiResponse<never>);
  },
);

export const markNotificationRead: RequestHandler = asyncHandler(
  async (request, response) => {
    const userId = request.auth!.userId;
    const agencyId = await getAgencyIdForMember(userId);
    const [notification] = await readNotification(
      userId,
      requireNotificationId(request.params.notificationId),
      agencyId,
    );
    if (!notification) throw new ApiError(404, "Notification not found.");

    response.json({
      success: true,
      message: "Notification marked as read.",
      data: notification,
    } satisfies ApiResponse<typeof notification>);
  },
);

export const notificationStream: RequestHandler = async (request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  response.flushHeaders();
  response.write("event: connected\ndata: {}\n\n");

  const heartbeat = setInterval(
    () => response.write(": heartbeat\n\n"),
    25_000,
  );

  const scope = requestedScope(request.query.scope);
  const agencyId = await resolveScopeAgencyId(
    request.auth!.userId,
    scope,
  ).catch(() => null);

  const removeClient =
    scope === "agency"
      ? agencyId
        ? addAgencyNotificationClient(agencyId, response)
        : () => {}
      : addNotificationClient(request.auth!.userId, response);

  request.on("close", () => {
    clearInterval(heartbeat);
    removeClient();
  });
};
