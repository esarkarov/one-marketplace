import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ telemetryMode: "off" }));

vi.mock("@/config/env.js", () => ({
  env: {
    get telemetryMode() {
      return flags.telemetryMode;
    },
  },
}));

const {
  currentTraceparent,
  formatTraceparent,
  parseTraceparent,
  withRelaySpan,
} = await import("@/modules/outbox/utils/outbox.trace.js");

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

describe("traceparent format", () => {
  it("round-trips a valid span context", () => {
    const value = formatTraceparent({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
    });

    expect(value).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    expect(parseTraceparent(value)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      isRemote: true,
    });
  });

  it.each([
    null,
    "",
    "garbage",
    `01-${TRACE_ID}-${SPAN_ID}-01`,
    `00-${"0".repeat(32)}-${SPAN_ID}-01`,
  ])("rejects %s", (value) => {
    expect(parseTraceparent(value)).toBeNull();
  });
});

describe("telemetry off", () => {
  beforeEach(() => {
    flags.telemetryMode = "off";
  });

  it("stores no traceparent and starts no span", async () => {
    const getTracer = vi.spyOn(trace, "getTracer");

    expect(currentTraceparent()).toBeNull();
    expect(
      await withRelaySpan(`00-${TRACE_ID}-${SPAN_ID}-01`, async () => "sent"),
    ).toBe("sent");
    expect(getTracer).not.toHaveBeenCalled();
    getTracer.mockRestore();
  });
});

describe("telemetry on", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    flags.telemetryMode = "console";
    exporter = new InMemorySpanExporter();
    context.setGlobalContextManager(new StackContextManager().enable());
    trace.setGlobalTracerProvider(
      new TracerProvider({
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      }),
    );
  });

  afterEach(() => {
    trace.disable();
    context.disable();
  });

  it("captures the active span as a traceparent", () => {
    const expected = trace
      .getTracer("test")
      .startActiveSpan("request", (span) => {
        const value = currentTraceparent();
        span.end();
        return { value, ids: span.spanContext() };
      });

    expect(expected.value).toBe(
      `00-${expected.ids.traceId}-${expected.ids.spanId}-01`,
    );
  });

  it("starts the relay span with a link to the stored traceparent", async () => {
    await withRelaySpan(`00-${TRACE_ID}-${SPAN_ID}-01`, async () => "sent");

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("outbox.relay.publish");
    expect(span?.links.map((link) => link.context.traceId)).toEqual([TRACE_ID]);
    expect(span?.spanContext().traceId).not.toBe(TRACE_ID);
  });
});
