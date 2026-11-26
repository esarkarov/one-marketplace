# Test plan: API observability (OpenTelemetry, part A)

## Scope

`services/api` telemetry behind `TELEMETRY_MODE` (ADR 0026): `src/bootstrap/instrumentation.ts`, `src/infrastructure/telemetry/{sdk,metrics,gauges}.ts`, the logger mixin and log-event listener in `src/config/logger.ts`, `app.request_id` in the request-id middleware, the gauges in `bootstrap/start.ts` and the `telemetry` shutdown step. Part B (Grafana container) is not covered.

Use throwaway credentials only. Never print the real `.env`.

Preconditions: `pnpm infra:up` (Postgres, Redis, RabbitMQ healthy), `pnpm --filter @onemarketplace/api build` for the `start:observed` rows.

Legend: U unit, E end to end / manual.

## How to start

- Built: `TELEMETRY_MODE=console PORT=4100 pnpm --filter @onemarketplace/api start:observed`
- Dev: `TELEMETRY_MODE=console pnpm --filter @onemarketplace/api dev:observed`
- With a collector: `TELEMETRY_MODE=otlp OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` and either command.
- Never set the preload through `NODE_OPTIONS`.

## 1. Mode off

| #   | Scenario                    | Steps                                 | Expected                                                                 | Type |
| --- | --------------------------- | ------------------------------------- | ------------------------------------------------------------------------ | ---- |
| 1.1 | No SDK module loaded        | `sdk.test.ts`                         | loader never called; no SDK, exporter or instrumentation module imported | U    |
| 1.2 | Behavior unchanged          | full API suite with the default env   | green; log lines carry no `trace_id`                                     | U    |
| 1.3 | `start` and `dev` unchanged | `pnpm start` without `TELEMETRY_MODE` | no span or metric output; no `db.pool.*` gauges registered               | E    |

## 2. Traces (mode console)

| #    | Scenario                | Steps                                                                                                                                                                            | Expected                                                                                                                 | Type |
| ---- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- |
| 2.1  | Route template          | `curl "http://localhost:4100/api/v1/jobs/public?query=abc&limit=5"`                                                                                                              | one trace: `GET /api/v1/jobs/public` with `http.route`, express `request handler`, `pg.query:SELECT`, `redis-EVAL` spans | E    |
| 2.2  | No query string         | search the span dump for `abc` and `url.query`                                                                                                                                   | no match; only `http.route`                                                                                              | E, U |
| 2.3  | No Authorization        | repeat 2.1 with `-H "Authorization: Bearer test-token"`, search for the token and `Bearer`                                                                                       | no match                                                                                                                 | E    |
| 2.4  | No client data          | search for `client.address`, `network.peer`, `user_agent`, your IP                                                                                                               | no match                                                                                                                 | E, U |
| 2.4b | No error details        | `curl -X POST -H "Content-Type: application/json" --data '{"password": marker}' http://localhost:4100/api/v1/auth/sign-up`, search the dump for `marker` and `exception.message` | no match; the `jsonBody` span has status `ERROR` and `exception.type: SyntaxError` only                                  | E, U |
| 2.5  | No SQL parameter values | `db.query.text` of the pg spans                                                                                                                                                  | placeholders (`$1`), never the query value                                                                               | E    |
| 2.6  | Redis commands only     | `db.query.text` of redis spans                                                                                                                                                   | command name only (`EVAL`), no keys                                                                                      | E, U |
| 2.7  | Probes not traced       | `curl http://localhost:4100/api/v1/health`                                                                                                                                       | no span                                                                                                                  | E, U |
| 2.8  | Request id              | send `-H "x-request-id: plan-1"`                                                                                                                                                 | server span and the request-id middleware span carry `app.request_id: plan-1`                                            | E, U |
| 2.9  | Trace id in logs        | match the `request completed` log line of 2.8                                                                                                                                    | `trace_id` equals the trace's id, `span_id` equals the server span id                                                    | E, U |
| 2.10 | Known quirk             | inspect express spans                                                                                                                                                            | one `router - /sign-up` span per request under `/api/v1` (accepted, ADR 0026)                                            | E    |

## 3. Metrics (mode console, exported every 10 s)

| #   | Scenario          | Steps                                                               | Expected                                                                         | Type |
| --- | ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| 3.1 | Gauges            | wait 10 s after startup                                             | `db.pool.total`, `db.pool.idle`, `db.pool.waiting`, `nodejs.eventloop.delay.p99` | E, U |
| 3.2 | Log event counter | `docker pause onemarketplace-redis`, two requests, `docker unpause` | `app.log.events{event_name="rate_limit.store.error"}` increments                 | E    |
| 3.3 | Degraded cache    | `metrics.test.ts`                                                   | `cache.redis.degraded` logged twice gives value 2 with `level="warn"`            | U    |
| 3.4 | Allowlist only    | `metrics.test.ts`                                                   | `system.startup` and unnamed events are not counted                              | U    |

## 4. Shutdown

| #   | Scenario       | Steps                                         | Expected                                                                                  | Type |
| --- | -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- | ---- |
| 4.1 | Order          | `shutdown.test.ts`                            | telemetry flush runs after `pool.end` and before exit                                     | U    |
| 4.2 | Bound          | `sdk.test.ts`                                 | a hanging flush returns after 2 s with `telemetry.shutdown.timeout`; exit code unaffected | U    |
| 4.3 | Collector down | mode `otlp` with nothing on 4318, then Ctrl+C | process exits within the bound; exporter errors do not change the exit code               | E    |

## 5. Not yet verified

- amqplib publish spans through `amqp-connection-manager` and trace propagation into the consumer (part B).
- Latency cost against the 1.2 load baseline (at most +10 % p95).
