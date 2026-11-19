import type { Channel } from "amqplib";
import type { NOTIFICATION_CREATED_TYPE } from "@/infrastructure/constants/index.js";

export interface DailyRoom {
  id: string;
  name: string;
  url: string;
  created_at: string;
}

export interface DailyErrorBody {
  error?: string;
  info?: string;
}

interface NotificationPayloadFields {
  type: string;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

interface RecipientTarget {
  recipientId: string;
  agencyId?: undefined;
}

interface AgencyTarget {
  agencyId: string;
  recipientId?: undefined;
}

type NotificationPayload = NotificationPayloadFields &
  (RecipientTarget | AgencyTarget);

export interface NotificationEnvelope {
  id: string;
  type: typeof NOTIFICATION_CREATED_TYPE;
  version: 2;
  occurredAt: string;
  payload: NotificationPayload;
}

export type NotificationInput = NotificationPayload & { eventId?: string };

export interface TopologyOptions {
  prefix?: string;
  deliveryLimit?: number;
}

export type TopologyChannel = Pick<
  Channel,
  "assertExchange" | "assertQueue" | "bindQueue"
>;
