import { JSONCodec } from "nats";
import { NotificationEvent, NOTIFICATIONS_SUBJECT } from "./subjects.js";
import { getNats, isNatsEnabled } from "../config/nats.js";
import { randomUUID } from "crypto";

const codec = JSONCodec<NotificationEvent>();

export const sendNotification = async (
  input: Omit<NotificationEvent, "eventId" | "createdAt">,
) => {
  const event = {
    ...input,
    eventId: randomUUID(),
    createdAt: new Date().toISOString(),
  } as NotificationEvent;

  if (!isNatsEnabled()) {
    return event;
  }

  const nats = await getNats();
  await nats.jetstream().publish(NOTIFICATIONS_SUBJECT, codec.encode(event));
  return event;
};
