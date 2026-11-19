import { z } from "zod";
import {
  ErrorBody,
  offsetPage,
  ok,
  okNoData,
} from "@/shared/responses/api-envelope.responses.js";
import { isoDateTime } from "@/shared/responses/scalar.responses.js";

const Notification = z
  .strictObject({
    id: z.uuid(),
    eventId: z.string(),
    recipientId: z.uuid().nullable(),
    agencyId: z.uuid().nullable(),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    link: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    isRead: z.boolean(),
    readAt: isoDateTime.nullable(),
    createdAt: isoDateTime.nullable(),
  })
  .meta({ id: "NotificationsNotification" });

export const notificationsResponses = {
  list: {
    200: ok(offsetPage(Notification)),
  },
  readAll: {
    200: okNoData,
  },
  read: {
    200: ok(z.strictObject({ id: z.uuid() })),
    404: ErrorBody,
  },
};
