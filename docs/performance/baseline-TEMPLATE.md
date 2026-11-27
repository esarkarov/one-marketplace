# Load baseline YYYY-MM-DD

Copy to `baseline-YYYY-MM-DD.md` and fill in. Method: ADR 0027. Steps: `infra/load/README.md`.

## Environment

| Field                   | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Date                    |                                                                                             |
| Machine, CPU, RAM       |                                                                                             |
| OS                      |                                                                                             |
| Docker Desktop version  |                                                                                             |
| Node version            |                                                                                             |
| k6                      | 2.4.0 (`grafana/k6:2.4.0`)                                                                  |
| Commit (given by owner) |                                                                                             |
| Database                | `onemarketplace_load`; seed counts: jobs , freelancers , agencies                           |
| API start, off          | `pnpm --filter @onemarketplace/api start` (`TRUST_PROXY=1`, `TELEMETRY_MODE=off`)           |
| API start, otlp         | `pnpm --filter @onemarketplace/api start:observed` (`TRUST_PROXY=1`, `TELEMETRY_MODE=otlp`) |
| API restarted per run   | yes                                                                                         |
| P95_MS threshold        |                                                                                             |
| Thresholds passed       | off-1 , off-2 , off-3 , otlp-1 , otlp-2 , otlp-3                                            |

## TELEMETRY_MODE off

Achieved rps = `http_reqs{scenario:<stage>}` count / stage seconds. Times in ms. Error rate in %.

| Stage   | Metric       | Run 1 | Run 2 | Run 3 | Median | Spread |
| ------- | ------------ | ----- | ----- | ----- | ------ | ------ |
| warmup  | achieved rps |       |       |       |        |        |
| warmup  | p50          |       |       |       |        |        |
| warmup  | p95          |       |       |       |        |        |
| warmup  | p99          |       |       |       |        |        |
| warmup  | error rate   |       |       |       |        |        |
| rps_25  | achieved rps |       |       |       |        |        |
| rps_25  | p50          |       |       |       |        |        |
| rps_25  | p95          |       |       |       |        |        |
| rps_25  | p99          |       |       |       |        |        |
| rps_25  | error rate   |       |       |       |        |        |
| rps_50  | achieved rps |       |       |       |        |        |
| rps_50  | p50          |       |       |       |        |        |
| rps_50  | p95          |       |       |       |        |        |
| rps_50  | p99          |       |       |       |        |        |
| rps_50  | error rate   |       |       |       |        |        |
| rps_100 | achieved rps |       |       |       |        |        |
| rps_100 | p50          |       |       |       |        |        |
| rps_100 | p95          |       |       |       |        |        |
| rps_100 | p99          |       |       |       |        |        |
| rps_100 | error rate   |       |       |       |        |        |
| rps_200 | achieved rps |       |       |       |        |        |
| rps_200 | p50          |       |       |       |        |        |
| rps_200 | p95          |       |       |       |        |        |
| rps_200 | p99          |       |       |       |        |        |
| rps_200 | error rate   |       |       |       |        |        |

## TELEMETRY_MODE otlp

| Stage   | Metric       | Run 1 | Run 2 | Run 3 | Median | Spread |
| ------- | ------------ | ----- | ----- | ----- | ------ | ------ |
| warmup  | achieved rps |       |       |       |        |        |
| warmup  | p50          |       |       |       |        |        |
| warmup  | p95          |       |       |       |        |        |
| warmup  | p99          |       |       |       |        |        |
| warmup  | error rate   |       |       |       |        |        |
| rps_25  | achieved rps |       |       |       |        |        |
| rps_25  | p50          |       |       |       |        |        |
| rps_25  | p95          |       |       |       |        |        |
| rps_25  | p99          |       |       |       |        |        |
| rps_25  | error rate   |       |       |       |        |        |
| rps_50  | achieved rps |       |       |       |        |        |
| rps_50  | p50          |       |       |       |        |        |
| rps_50  | p95          |       |       |       |        |        |
| rps_50  | p99          |       |       |       |        |        |
| rps_50  | error rate   |       |       |       |        |        |
| rps_100 | achieved rps |       |       |       |        |        |
| rps_100 | p50          |       |       |       |        |        |
| rps_100 | p95          |       |       |       |        |        |
| rps_100 | p99          |       |       |       |        |        |
| rps_100 | error rate   |       |       |       |        |        |
| rps_200 | achieved rps |       |       |       |        |        |
| rps_200 | p50          |       |       |       |        |        |
| rps_200 | p95          |       |       |       |        |        |
| rps_200 | p99          |       |       |       |        |        |
| rps_200 | error rate   |       |       |       |        |        |

## Side by side (medians)

| Stage   | rps off | rps otlp | p50 off | p50 otlp | p95 off | p95 otlp | p99 off | p99 otlp | errors off | errors otlp |
| ------- | ------- | -------- | ------- | -------- | ------- | -------- | ------- | -------- | ---------- | ----------- |
| warmup  |         |          |         |          |         |          |         |          |            |             |
| rps_25  |         |          |         |          |         |          |         |          |            |             |
| rps_50  |         |          |         |          |         |          |         |          |            |             |
| rps_100 |         |          |         |          |         |          |         |          |            |             |
| rps_200 |         |          |         |          |         |          |         |          |            |             |

## Telemetry cost: p95 otlp vs off

Budget: at most +10 % p95 (roadmap Part 3 item 1.1 and Part 4, ADR 0026).

| Stage   | p95 off (median) | p95 otlp (median) | Delta % | Within +10 %? (yes/no) |
| ------- | ---------------- | ----------------- | ------- | ---------------------- |
| warmup  |                  |                   |         |                        |
| rps_25  |                  |                   |         |                        |
| rps_50  |                  |                   |         |                        |
| rps_100 |                  |                   |         |                        |
| rps_200 |                  |                   |         |                        |

## Pool and event loop

Max within each stage window, median of the three runs. Prometheus: `db_pool_waiting`, `nodejs_eventloop_delay_p99_milliseconds`.

| Stage   | db.pool.waiting max, off | db.pool.waiting max, otlp | event-loop p99 max ms, off | event-loop p99 max ms, otlp |
| ------- | ------------------------ | ------------------------- | -------------------------- | --------------------------- |
| warmup  | not measured             |                           | not measured               |                             |
| rps_25  | not measured             |                           | not measured               |                             |
| rps_50  | not measured             |                           | not measured               |                             |
| rps_100 | not measured             |                           | not measured               |                             |
| rps_200 | not measured             |                           | not measured               |                             |

## Per route p95 (whole run, median of three runs, ms)

| Route             | off | otlp |
| ----------------- | --- | ---- |
| feed              |     |      |
| freelancer_search |     |      |
| agency_search     |     |      |
| ready             |     |      |

## Dropped iterations and rate limiting

| Stage   | dropped_iterations off (median) | dropped_iterations otlp (median) |
| ------- | ------------------------------- | -------------------------------- |
| warmup  |                                 |                                  |
| rps_25  |                                 |                                  |
| rps_50  |                                 |                                  |
| rps_100 |                                 |                                  |
| rps_200 |                                 |                                  |

`rate_limited` count over all runs (must be 0):

## Top bottleneck

Name it from the evidence above (for example: the stage where p95 or errors rise first, whether `db.pool.waiting` rises before the event-loop delay, which route's p95 grows fastest, dropped iterations). State what the evidence does not show.

## Limits

- Local only, one machine, k6 and the API on the same host. No extrapolation to production.
- Public reads and `/ready` only; authenticated routes and writes are not measured.
- Rate limiters bypassed by `X-Forwarded-For` with `TRUST_PROXY=1`, local only.

## Threshold after this baseline

Per stage p95 threshold = 1.5 x median p95 (ADR 0027):
