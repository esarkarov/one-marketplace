import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import {
  listNotificationsRequest,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
  notificationStreamRequest,
} from "@/modules/notifications/schemas/notifications.schema.js";
import { ApiResponse } from "@/types/common.types.js";
import {
  getNotifications,
  readAllNotifications,
  readNotification,
} from "@/modules/notifications/services/notifications.service.js";
import { getAgencyIdForMember } from "@/modules/agency/index.js";
import {
  addAgencyNotificationClient,
  addNotificationClient,
} from "@/modules/notifications/services/notifications.sse.js";
import { ApiError } from "@/shared/errors/api-error.js";
import {
  assertSseAvailable,
  registerSseStream,
} from "@/middleware/utils/sse-streams.utils.js";

type Scope = "agency" | "default";

const requestedScope = (value: unknown): Scope =>
  value === "agency" ? "agency" : "default";

const resolveScopeAgencyId = async (userId: string, scope: Scope) =>
  scope === "agency" ? getAgencyIdForMember(userId) : null;

export const listNotifications: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, listNotificationsRequest);
    const scope = requestedScope(query.scope);
    const agencyId = await resolveScopeAgencyId(request.auth!.userId, scope);

    const data =
      scope === "agency" && !agencyId
        ? { results: [], hasMore: false }
        : await getNotifications(request.auth!.userId, agencyId, {
            limit: query.limit,
            offset: query.offset,
          });

    response.json({
      success: true,
      message: "Notifications retrieved.",
      data,
    } satisfies ApiResponse<typeof data>);
  },
);

export const markAllNotificationsRead: RequestHandler = asyncHandler(
  async (request, response) => {
    const { query } = getValidated(request, markAllNotificationsReadRequest);
    const scope = requestedScope(query.scope);
    const agencyId = await resolveScopeAgencyId(request.auth!.userId, scope);

    if (scope !== "agency" || agencyId) {
      await readAllNotifications(request.auth!.userId, agencyId);
    }

    response.json({
      success: true,
      message: "Notifications marked as read.",
      data: null,
    } satisfies ApiResponse<null>);
  },
);

export const markNotificationRead: RequestHandler = asyncHandler(
  async (request, response) => {
    const userId = request.auth!.userId;
    const agencyId = await getAgencyIdForMember(userId);
    const { params } = getValidated(request, markNotificationReadRequest);
    const [notification] = await readNotification(
      userId,
      params.notificationId,
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
  assertSseAvailable(response);

  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  response.flushHeaders();
  registerSseStream(response);
  response.write("event: connected\ndata: {}\n\n");

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, 25_000);

  const { query } = getValidated(request, notificationStreamRequest);
  const scope = requestedScope(query.scope);
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
