import { z } from "zod";
import {
  ErrorBody,
  isoDateTime,
  ok,
  okNoData,
} from "../../utils/response-schemas.js";

const Notification = z
  .strictObject({
    id: z.uuid(),
    event_id: z.string(),
    recipient_id: z.string().nullable(),
    agency_id: z.uuid().nullable(),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    link: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    is_read: z.boolean(),
    read_at: isoDateTime.nullable(),
    created_at: isoDateTime.nullable(),
  })
  .meta({ id: "NotificationsNotification" });

export const notificationsResponses = {
  list: {
    200: ok(z.array(Notification)),
  },
  readAll: {
    200: okNoData,
  },
  read: {
    200: ok(z.strictObject({ id: z.uuid() })),
    404: ErrorBody,
  },
};
