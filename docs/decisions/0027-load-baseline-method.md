# 0027: Load baseline method

Status: accepted (2026-11-27, learning roadmap item 1.2). Label: measurement, not a pattern.

## Context

The learning roadmap (`docs/research/backend-evolution/04-learning-roadmap.md`, Part 3, 1.2) needs numbers before patterns are introduced: ADR 0026 accepts at most +10 % p95 for telemetry, and later items need a regression guard. The API had no load test and no recorded latency under load.

## Decision

### Method

- k6 runs from the pinned `grafana/k6:2.4.0` image through `infra/load/docker-compose.yml` (`pnpm load:public`); nothing is installed into the repo. The brief's `docker run --network host` is replaced by a compose file that mounts `infra/load` relative to itself and reaches the API through `host.docker.internal` (`host-gateway`), because root scripts run under `cmd.exe` on Windows and Docker Desktop host networking differs from Linux.
- Open model: stages are separate `constant-arrival-rate` scenarios with `startTime` offsets (warm-up 10 rps for 30 s, then 25, 50, 100 and 200 rps for 60 s each; `preAllocatedVUs` 50, `maxVUs` 400), so arrivals do not slow down when the API does.
- Mix: 50 % job feed, 25 % freelancer search, 10 % agency search, 15 % `/api/v1/ready` as a control, assigned by iteration number so the mix is exact.
- Data: a dedicated local database `onemarketplace_load` on the local Docker Postgres, filled by `infra/load/seed/seed.sql` (10 000 published jobs, 5 000 freelancers, 1 000 agencies). The API runs from `dist` with its logs in a file.
- Three runs per configuration, API restarted before each run, reported as median and spread (max minus min) per stage. Two configurations: `TELEMETRY_MODE=off` and `TELEMETRY_MODE=otlp` against the local Grafana stack, which also gives `db.pool.waiting` and the event-loop p99.
- Results: `docs/performance/baseline-<date>.md` from `docs/performance/baseline-TEMPLATE.md`. Steps: `infra/load/README.md`.

### Limits

- Public reads and `/ready` only: authenticated routes need Clerk tokens. Write scenarios are a recorded gap.
- Local numbers only, measured on the owner's machine with k6 and the API on the same host. No extrapolation to production.
- The rate limiters are kept out of the measurement by a random `X-Forwarded-For` from 5 000 private addresses with `TRUST_PROXY=1` set on the API's command line. This is local only; production keeps its real proxy hop count. Any 429 fails the run.

### Threshold policy

- v1: `http_req_failed` rate < 1 %, `http_req_duration` p95 < 1000 ms (placeholder, `P95_MS`), no 429, checks > 99 %, without `abortOnFail`; per-stage and per-route p95 sub-metrics carry the same limit so the summary export holds per-stage numbers.
- After the first accepted baseline: p95 threshold per stage is 1.5 times the measured median p95 of that stage, as a regression guard. A change of the threshold is recorded in the baseline file.

## Consequences

- Owner steps (create, migrate and seed the load database, start the API, run, clean up) are manual and documented; agents do not run load against anything.
- k6 summary files are written to `infra/load/results/` (git-ignored except `.gitkeep`, because k6 does not create the folder).
- `infra/load/*.js` is outside every eslint config (k6 runtime modules, not Node); prettier covers it.
- Reverse: delete `infra/load/`, `docs/performance/` and this ADR.
