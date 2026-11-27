import {
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  trace,
  type Link,
  type SpanContext,
} from "@opentelemetry/api";
import { env } from "@/config/env.js";
import { TELEMETRY_METER_NAME } from "@/infrastructure/telemetry/metrics.js";
import { OUTBOX_RELAY_SPAN_NAME } from "@/modules/outbox/constants/outbox.constants.js";

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const isTelemetryOn = (): boolean => env.telemetryMode !== "off";

export const formatTraceparent = (context: SpanContext): string | null => {
  if (!isSpanContextValid(context)) return null;
  const flags = (context.traceFlags & 0xff).toString(16).padStart(2, "0");
  return `00-${context.traceId}-${context.spanId}-${flags}`;
};

export const parseTraceparent = (
  traceparent: string | null,
): SpanContext | null => {
  const match = traceparent ? TRACEPARENT_PATTERN.exec(traceparent) : null;
  if (!match) return null;
  const [, traceId = "", spanId = "", flags = "00"] = match;
  const context: SpanContext = {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    isRemote: true,
  };
  return isSpanContextValid(context) ? context : null;
};

export const currentTraceparent = (): string | null => {
  if (!isTelemetryOn()) return null;
  const context = trace.getActiveSpan()?.spanContext();
  return context ? formatTraceparent(context) : null;
};

export const withRelaySpan = async <T>(
  traceparent: string | null,
  run: () => Promise<T>,
): Promise<T> => {
  if (!isTelemetryOn()) return run();
  const linked = parseTraceparent(traceparent);
  const links: Link[] = linked ? [{ context: linked }] : [];
  return trace
    .getTracer(TELEMETRY_METER_NAME)
    .startActiveSpan(
      OUTBOX_RELAY_SPAN_NAME,
      { kind: SpanKind.PRODUCER, links },
      async (span) => {
        try {
          return await run();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
};
