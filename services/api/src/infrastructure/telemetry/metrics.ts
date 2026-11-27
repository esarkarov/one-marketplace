import { metrics } from "@opentelemetry/api";
import type { ObservableResult } from "@opentelemetry/api";
import { registerLogEventListener } from "@/config/logger.js";
import type { LogEvent } from "@/config/logger.js";

export const TELEMETRY_METER_NAME = "onemarketplace-api";

export const COUNTED_LOG_EVENTS: ReadonlySet<string> = new Set([
  "system.request.failed",
  "redis.error",
  "auth.cache.invalidate_failed",
  "rate_limit.store.error",
  "webhook.inbound.dedupe_unavailable",
  "queue.publish.skipped",
  "queue.publish.failed",
  "payment.refund.unrecoverable",
  "payment.refund.no_payment_intent",
  "payment.orphan.detected",
  "payment.orphan.truncated",
  "payment.payout.notification_failed",
  "cache.redis.degraded",
  "queue.dead_letter.nonempty",
  "payout.run.capped",
  "payout.run.budget_exhausted",
  "video.daily.request_failed",
  "outbox.relay.failed",
  "outbox.relay.lag",
  "outbox.event.dead",
]);

export interface ExternalCall {
  service: string;
  operation: string;
  outcome: "success" | "failure" | "timeout" | "aborted" | "circuit_open";
  durationMs: number;
  attempts: number;
}

export type ExternalCallObserver = (call: ExternalCall) => void;

let externalCallObserver: ExternalCallObserver | null = null;

export const registerExternalCallObserver = (
  observer: ExternalCallObserver | null,
): void => {
  externalCallObserver = observer;
};

export const reportExternalCall = (call: ExternalCall): void => {
  if (!externalCallObserver) return;
  try {
    externalCallObserver(call);
  } catch {
    return;
  }
};

export type GaugeCallback = () => number | undefined;

export const registerGauge = (
  name: string,
  callback: GaugeCallback,
  unit?: string,
): (() => void) => {
  const gauge = metrics
    .getMeter(TELEMETRY_METER_NAME)
    .createObservableGauge(name, unit ? { unit } : undefined);
  const observe = (result: ObservableResult) => {
    const value = callback();
    if (value !== undefined && Number.isFinite(value)) result.observe(value);
  };
  gauge.addCallback(observe);
  return () => gauge.removeCallback(observe);
};

export const startMetrics = (): (() => void) => {
  const meter = metrics.getMeter(TELEMETRY_METER_NAME);
  const logEvents = meter.createCounter("app.log.events", {
    description: "Allowlisted log events by name and level",
  });
  const callDuration = meter.createHistogram("app.external.call.duration", {
    unit: "ms",
  });
  const callAttempts = meter.createCounter("app.external.call.attempts");

  registerLogEventListener(({ eventName, level }: LogEvent) => {
    if (!COUNTED_LOG_EVENTS.has(eventName)) return;
    logEvents.add(1, { event_name: eventName, level });
  });
  registerExternalCallObserver((call) => {
    const attributes = {
      service: call.service,
      operation: call.operation,
      outcome: call.outcome,
    };
    callDuration.record(call.durationMs, attributes);
    callAttempts.add(call.attempts, attributes);
  });

  return () => {
    registerLogEventListener(null);
    registerExternalCallObserver(null);
  };
};
