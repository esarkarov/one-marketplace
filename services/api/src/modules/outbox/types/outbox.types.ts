import type { NotificationInput } from "@/infrastructure/types/index.js";

export type OutboxMode = "off" | "shadow" | "on";

export type OutboxNotificationInput = NotificationInput & { eventId: string };

export type OutboxSendResult = "published" | "disabled" | "failed";

export type OutboxSender = (
  input: NotificationInput,
) => Promise<OutboxSendResult>;

export interface OutboxRelayDeps {
  send: OutboxSender;
  isReady: () => boolean;
}

export interface OutboxEventInsert {
  eventId: string;
  payload: Record<string, unknown>;
  traceparent: string | null;
}

export interface ClaimedOutboxEvent {
  id: string;
  eventId: string;
  payload: unknown;
  traceparent: string | null;
  attempts: number;
}

export interface OutboxClaimOptions {
  limit: number;
  leaseMs: number;
}

export interface OutboxStats {
  pending: number;
  oldestPendingAgeMs: number;
  dead: number;
}

export interface OutboxBatchResult {
  claimed: number;
  published: number;
  retried: number;
  dead: number;
  released: number;
  stale: number;
}
