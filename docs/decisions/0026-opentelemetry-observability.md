# 0026: OpenTelemetry traces and metrics behind a flag

Status: adopted for learning (2026-11-27, learning roadmap item 1.1, part A)

## Context

The API had logs only: no traces, no metrics, and the alert names in `services/api/AGENTS.md` were log event names nobody counted (evaluation C1, `docs/research/backend-evolution/02-evaluation.md`). The learning roadmap (`docs/research/backend-evolution/04-learning-roadmap.md`, Part 3, 1.1) asks for OpenTelemetry behind a flag that is off by default, so the API without the flag behaves as before. Part B (a local Grafana stack in `infra/docker`) is a later step and is not part of this record.

A step 0 spike (throwaway preloads `services/api/otel-spike.mjs` and `otel-spike-io.mjs`, against the built `dist` on Node 26) settled the open points before the build.

## Decision

### Flags

`config/env.ts`: `TELEMETRY_MODE=off|console|otlp` (default `off`), `OTEL_EXPORTER_OTLP_ENDPOINT` (http or https URL, default `http://127.0.0.1:4318`), `TELEMETRY_SERVICE_NAME` (default `onemarketplace-api`). `console` prints spans and metrics to stdout so evidence needs no collector.

### Startup

- Preload `src/bootstrap/instrumentation.ts`, never imported by application code. With mode `off` it imports only `config/env.ts` and returns. Otherwise it calls `register({ include: ["express", "pg", "redis", "amqplib"] })` from `import-in-the-middle/register-hooks.mjs` (the synchronous `module.registerHooks` route, Node 26 qualifies) and then `startTelemetry()`.
- No `--experimental-loader` and no `module.register`: the spike showed the synchronous hooks give Express route names under ESM without the loader thread or its warning.
- Scripts: `start:observed` is `node --import ./dist/bootstrap/instrumentation.js --env-file-if-exists=../../.env dist/server.js`; `dev:observed` passes the same `--import` (the `.ts` preload) to `tsx watch`. Never through `NODE_OPTIONS`, which would also load the preload into pnpm and the tsx watcher parent. `start` and `dev` are unchanged.

### SDK (`src/infrastructure/telemetry/sdk.ts`)

- `startTelemetry(settings, load)` loads every SDK, exporter and instrumentation module through one dynamic loader, so mode `off` imports none of them. Only `@opentelemetry/api` is loaded statically (logger, request id, metrics), and it is a no-op without an SDK.
- `NodeSDK` with explicit exporters for all three signals: `BatchSpanProcessor({ exporter })`, one `PeriodicExportingMetricReader` (10 s interval), `logRecordProcessors: []`. Without these the SDK builds OTLP metric and log exporters from env defaults, so mode `console` would still send OTLP. Mode `otlp` uses the HTTP exporters at `<endpoint>/v1/traces` and `/v1/metrics`.
- http: health and readiness probes are not traced. `startIncomingSpanHook` returns `undefined` for `url.query`, `url.path` (an admin route carries a Redis key in its path; `http.route` keeps the template), `client.address`, `user_agent.original`, `network.peer.address` and `network.peer.port`; hook attributes are merged last and the SDK drops undefined values, so those keys never reach the span (mechanism of `instrumentation-http` 0.301.2). `startOutgoingSpanHook` rewrites `url.full` without its query and drops the user agent. `applyCustomAttributesOnSpan` sets `app.request_id` on the server span from the response header. No header capture. `http.route` stays.
- express (not the router instrumentation as well, evaluation C1); pg with `enhancedDatabaseReporting: false, requireParentSpan: true`; amqplib with defaults; redis with `dbStatementSerializer` returning only the command name (keys and arguments can hold IP prefixes) and `requireParentSpan: true`.
- Error details: a span processor (`errorDetailScrubber`) runs in `onEnding` and removes `exception.message` and `exception.stacktrace` from exception events and the status message, keeping `exception.type` and the error code. Express records errors passed to `next(err)` (the JSON parser's `SyntaxError` quotes part of the body), and pg and Redis put raw driver messages into the status. Resource detectors are disabled (`resourceDetectors: []`), so exports carry no OS user, command line or host name; the resource is `service.name` plus the SDK defaults.
- `shutdownTelemetry()` flushes and stops the SDK, bounded by 2 s; a timeout or failure logs `telemetry.shutdown.timeout` or `telemetry.shutdown.failed` (warn) and never fails the shutdown. `bootstrap/shutdown.ts` runs it as the step `telemetry` after `pool.end` and before `exitWithFlush`, so the spans of the shutdown itself are flushed. The flush is best effort: when the earlier steps use up the 10 s forced-exit timer, the process exits during the flush and the shutdown spans are lost.

### Logs and metrics

- `config/logger.ts`: a pino `mixin` returns a new object `{ trace_id, span_id }` only when an active, valid span exists, else `{}`. `registerLogEventListener(fn | null)` is called from the app logger's write with `{ eventName, level }` only, never the message or attributes; a throwing listener is ignored.
- `metrics.ts`: counter `app.log.events{event_name, level}` fed by the listener for an allowlist of 17 names (the 12 of evaluation C1 plus `cache.redis.degraded`, `queue.dead_letter.nonempty`, `payout.run.capped`, `payout.run.budget_exhausted`, `video.daily.request_failed`). Histogram `app.external.call.duration` and counter `app.external.call.attempts` are reserved for item 1.3 through `registerExternalCallObserver` and `reportExternalCall`. `registerGauge(name, callback)` returns its removal function.
- `gauges.ts`: `db.pool.total|idle|waiting` from the pg pool and `nodejs.eventloop.delay.p99` (ms, `monitorEventLoopDelay`), registered in `bootstrap/start.ts` after the notification consumer, only when the mode is not `off`.
- `middleware/request-id`: also sets `app.request_id` on the active span (an Express middleware span).

### Spike and evidence results per instrumentation

| Instrumentation        | Works                  | Notes                                                                                                                                                         |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| http 0.301.2           | yes                    | server span `GET /api/v1/jobs/public` with `http.route`; scrubbed keys absent                                                                                 |
| express 0.73.0         | yes                    | route templates appear with the sync hooks; one stray `router - /sign-up` span per request under `/api/v1` is an accepted upstream quirk of Express 5 routers |
| pg 0.78.0              | yes                    | `pg-pool.connect` and `pg.query:SELECT` spans; SQL text with placeholders, no parameter values                                                                |
| redis 0.73.0           | yes                    | node-redis 6.3.1 produces `redis-EVAL` (rate limiter) and `redis-connect` spans; `db.query.text` is the command name only                                     |
| amqplib 0.72.0         | not verified in part A | no public request publishes; publish through `amqp-connection-manager` stays to be checked in part B                                                          |
| router instrumentation | not used               | duplicates Express 5 spans with express (evaluation C1)                                                                                                       |

Evidence (mode `console`, `pnpm start:observed`, 2026-11-27): one `GET /api/v1/jobs/public?query=...&limit=5` with an `Authorization: Bearer ...` header produced one trace of 27 spans (http, express, redis, pg). A text search of the span dump found neither the query value, the token, `Bearer`, an `Authorization` key, a client or peer address nor a user agent. The pino-http line of that request carried the trace's `trace_id` and the server span's `span_id`. With Redis paused, `app.log.events{event_name="rate_limit.store.error", level="warn"}` was exported with value 1; `cache.redis.degraded` is covered by a unit test through the real logger and a real counter, because its only request-path caller sits behind Clerk token verification. Mode `off` is covered by the unchanged suite. A second run sent `POST /api/v1/auth/sign-up` with a malformed JSON body containing a marker word: the `jsonBody` span had status `ERROR` and one exception event with only `exception.type: SyntaxError`; the marker, `exception.message`, `url.path` and the process resource attributes were absent from the span dump.

## Consequences

- Dependencies (API only, pinned): `@opentelemetry/api` 1.10.0, `sdk-node`, `exporter-trace-otlp-http`, `exporter-metrics-otlp-http`, `instrumentation`, `instrumentation-http` 0.301.2, `instrumentation-express` 0.73.0, `instrumentation-pg` 0.78.0, `instrumentation-amqplib` 0.72.0, `instrumentation-redis` 0.73.0, `sdk-metrics` and `sdk-trace` 3.1.1, `import-in-the-middle` 3.7.0. `sdk-trace` is a runtime dependency because the SDK file uses its span processor and console exporter. `sdk-node` pulls `protobufjs`, whose postinstall only prints a version-scheme warning and is not needed.
- Full SQL text (with placeholders) is a span attribute in modes other than `off`. Inline literals in raw SQL would appear there; parameters do not.
- Span attributes are not covered by the pino redaction; new instrumentations or hooks must be checked for leaks the same way.
- Outgoing HTTP calls carry a W3C `traceparent` header to third parties (Stripe, Clerk, Daily, ImageKit) when telemetry is on.
- Enforced by `sdk.test.ts` (mode off loads nothing, attribute and error-detail scrubbing, shutdown bound), `metrics.test.ts`, `gauges.test.ts`, `logger.test.ts` (mixin, listener), `request-id.middleware.test.ts`, `shutdown.test.ts` (ordering) and `infrastructure-layout.test.ts` (`telemetry` service folder).
- Reverse: `TELEMETRY_MODE=off` (the default), or revert the change.
- Open: amqplib publish spans and trace propagation into the consumer; latency cost against the 1.2 load baseline (accept at most +10 % p95); the Grafana stack (part B).
