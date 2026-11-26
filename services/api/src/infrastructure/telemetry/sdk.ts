import type {
  ClientRequest,
  IncomingMessage,
  RequestOptions,
  ServerResponse,
} from "node:http";
import type { Attributes, Span } from "@opentelemetry/api";
import type * as ExporterMetricsOtlp from "@opentelemetry/exporter-metrics-otlp-http";
import type * as ExporterTraceOtlp from "@opentelemetry/exporter-trace-otlp-http";
import type * as InstrumentationAmqplib from "@opentelemetry/instrumentation-amqplib";
import type * as InstrumentationExpress from "@opentelemetry/instrumentation-express";
import type * as InstrumentationHttp from "@opentelemetry/instrumentation-http";
import type * as InstrumentationPg from "@opentelemetry/instrumentation-pg";
import type * as InstrumentationRedis from "@opentelemetry/instrumentation-redis";
import type * as SdkMetrics from "@opentelemetry/sdk-metrics";
import type * as SdkNode from "@opentelemetry/sdk-node";
import type * as SdkTrace from "@opentelemetry/sdk-trace";
import { API_PREFIX } from "@/config/constants.js";
import { logger } from "@/config/logger.js";
import { errorLogAttributes } from "@/shared/logging/sanitize-log.js";
import { startMetrics } from "./metrics.js";

export type TelemetryMode = "off" | "console" | "otlp";

export interface TelemetrySettings {
  mode: TelemetryMode;
  endpoint: string;
  serviceName: string;
}

export interface TelemetryModules {
  sdkNode: typeof SdkNode;
  sdkTrace: typeof SdkTrace;
  sdkMetrics: typeof SdkMetrics;
  exporterTraceOtlp: typeof ExporterTraceOtlp;
  exporterMetricsOtlp: typeof ExporterMetricsOtlp;
  instrumentationHttp: typeof InstrumentationHttp;
  instrumentationExpress: typeof InstrumentationExpress;
  instrumentationPg: typeof InstrumentationPg;
  instrumentationAmqplib: typeof InstrumentationAmqplib;
  instrumentationRedis: typeof InstrumentationRedis;
}

export type TelemetryLoader = () => Promise<TelemetryModules>;

export interface TelemetryHandle {
  shutdown: () => Promise<void>;
}

export const INSTRUMENTED_PACKAGES = [
  "express",
  "pg",
  "redis",
  "amqplib",
] as const;

export const METRIC_EXPORT_INTERVAL_MS = 10_000;
export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 2_000;

const IGNORED_INCOMING_PATHS = new Set([
  `${API_PREFIX}/health`,
  `${API_PREFIX}/ready`,
]);

const REMOVED_INCOMING_ATTRIBUTES = [
  "url.query",
  "url.path",
  "client.address",
  "user_agent.original",
  "network.peer.address",
  "network.peer.port",
] as const;

const REMOVED_EXCEPTION_ATTRIBUTES = [
  "exception.message",
  "exception.stacktrace",
] as const;

const withoutQuery = (value: string): string => {
  const index = value.search(/[?#]/);
  return index === -1 ? value : value.slice(0, index);
};

const withoutTrailingSlash = (value: string): string =>
  value.length > 1 ? value.replace(/\/+$/, "") : value;

export const isIgnoredIncomingRequest = (request: IncomingMessage): boolean =>
  IGNORED_INCOMING_PATHS.has(
    withoutTrailingSlash(withoutQuery(request.url ?? "")),
  );

export const scrubIncomingAttributes = (): Attributes =>
  Object.fromEntries(
    REMOVED_INCOMING_ATTRIBUTES.map((key) => [key, undefined]),
  );

export const scrubOutgoingAttributes = (
  options: RequestOptions,
): Attributes => {
  const protocol = options.protocol ?? "http:";
  const host = options.hostname ?? options.host ?? "localhost";
  const port =
    options.port && !(options.hostname === undefined && host.includes(":"))
      ? `:${options.port}`
      : "";
  const path = withoutQuery(options.path ?? "/");
  return {
    "url.full": `${protocol}//${host}${port}${path}`,
    "user_agent.original": undefined,
  };
};

export const tagRequestId = (
  span: Span,
  _request: ClientRequest | IncomingMessage,
  response: IncomingMessage | ServerResponse,
): void => {
  if (!("getHeader" in response)) return;
  const requestId = response.getHeader("x-request-id");
  if (typeof requestId === "string") {
    span.setAttribute("app.request_id", requestId);
  }
};

export const scrubErrorDetails = (span: SdkTrace.Span): void => {
  for (const event of span.events) {
    if (event.name !== "exception" || !event.attributes) continue;
    for (const key of REMOVED_EXCEPTION_ATTRIBUTES) {
      delete event.attributes[key];
    }
  }
  if (span.status.message !== undefined) {
    span.setStatus({ code: span.status.code });
  }
};

export const errorDetailScrubber: SdkTrace.SpanProcessor = {
  onStart: () => undefined,
  onEnding: scrubErrorDetails,
  onEnd: () => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

export const redisStatement = (commandName: string): string => commandName;

export const loadTelemetryModules: TelemetryLoader = async () => {
  const [
    sdkNode,
    sdkTrace,
    sdkMetrics,
    exporterTraceOtlp,
    exporterMetricsOtlp,
    instrumentationHttp,
    instrumentationExpress,
    instrumentationPg,
    instrumentationAmqplib,
    instrumentationRedis,
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/exporter-metrics-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-express"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-amqplib"),
    import("@opentelemetry/instrumentation-redis"),
  ]);
  return {
    sdkNode,
    sdkTrace,
    sdkMetrics,
    exporterTraceOtlp,
    exporterMetricsOtlp,
    instrumentationHttp,
    instrumentationExpress,
    instrumentationPg,
    instrumentationAmqplib,
    instrumentationRedis,
  };
};

const createExporters = (
  modules: TelemetryModules,
  settings: TelemetrySettings,
) => {
  const base = settings.endpoint.replace(/\/+$/, "");
  if (settings.mode === "otlp") {
    return {
      spanExporter: new modules.exporterTraceOtlp.OTLPTraceExporter({
        url: `${base}/v1/traces`,
      }),
      metricExporter: new modules.exporterMetricsOtlp.OTLPMetricExporter({
        url: `${base}/v1/metrics`,
      }),
    };
  }
  return {
    spanExporter: new modules.sdkTrace.ConsoleSpanExporter(),
    metricExporter: new modules.sdkMetrics.ConsoleMetricExporter(),
  };
};

export const createTelemetrySdk = (
  modules: TelemetryModules,
  settings: TelemetrySettings,
): SdkNode.NodeSDK => {
  const { spanExporter, metricExporter } = createExporters(modules, settings);
  return new modules.sdkNode.NodeSDK({
    serviceName: settings.serviceName,
    resourceDetectors: [],
    spanProcessors: [
      errorDetailScrubber,
      new modules.sdkTrace.BatchSpanProcessor({ exporter: spanExporter }),
    ],
    metricReaders: [
      new modules.sdkMetrics.PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    logRecordProcessors: [],
    instrumentations: [
      new modules.instrumentationHttp.HttpInstrumentation({
        ignoreIncomingRequestHook: isIgnoredIncomingRequest,
        startIncomingSpanHook: scrubIncomingAttributes,
        startOutgoingSpanHook: scrubOutgoingAttributes,
        applyCustomAttributesOnSpan: tagRequestId,
      }),
      new modules.instrumentationExpress.ExpressInstrumentation(),
      new modules.instrumentationPg.PgInstrumentation({
        enhancedDatabaseReporting: false,
        requireParentSpan: true,
      }),
      new modules.instrumentationAmqplib.AmqplibInstrumentation(),
      new modules.instrumentationRedis.RedisInstrumentation({
        dbStatementSerializer: redisStatement,
        requireParentSpan: true,
      }),
    ],
  });
};

let active: TelemetryHandle | null = null;

export const startTelemetry = async (
  settings: TelemetrySettings,
  load: TelemetryLoader = loadTelemetryModules,
): Promise<boolean> => {
  if (settings.mode === "off" || active) return false;
  const modules = await load();
  const sdk = createTelemetrySdk(modules, settings);
  sdk.start();
  const stopMetrics = startMetrics();
  active = {
    shutdown: async () => {
      stopMetrics();
      await sdk.shutdown();
    },
  };
  return true;
};

export const setActiveTelemetry = (handle: TelemetryHandle | null): void => {
  active = handle;
};

export const shutdownTelemetry = async (
  timeoutMs: number = TELEMETRY_SHUTDOWN_TIMEOUT_MS,
): Promise<void> => {
  const current = active;
  if (!current) return;
  active = null;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      current.shutdown().then(
        () => "done" as const,
        (error: unknown) => error,
      ),
      timedOut,
    ]);
    if (outcome === "done") return;
    await logger.warn({
      message:
        outcome === "timeout"
          ? "Telemetry flush did not finish in time. Continuing."
          : "Telemetry flush failed. Continuing.",
      eventName:
        outcome === "timeout"
          ? "telemetry.shutdown.timeout"
          : "telemetry.shutdown.failed",
      attributes: {
        "shutdown.timeout_ms": timeoutMs,
        ...(outcome === "timeout" ? {} : errorLogAttributes(outcome)),
      },
    });
  } finally {
    clearTimeout(timer);
  }
};
