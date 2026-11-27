# Load baseline (public reads)

Measures how the API behaves under a stepped, open-model load on its public read routes, so later changes (telemetry, caching, patterns from the learning roadmap) can be compared against numbers instead of guesses. Method and limits: ADR 0027 (`docs/decisions/0027-load-baseline-method.md`). Results go into a copy of `docs/performance/baseline-template.md`.

## Scope and limits

- Routes: `GET /api/v1/jobs/public` (50 %), `GET /api/v1/freelancer/search` (25 %), `GET /api/v1/agency/search` (10 %) and `GET /api/v1/ready` (15 %, control, exempt from rate limits). The mix is exact: iteration `n` of each stage takes slot `n % 20`.
- Authenticated routes need Clerk tokens and are not loaded. Write scenarios are a recorded gap.
- Local only. Numbers from one laptop do not extrapolate to production.
- Stages are separate `constant-arrival-rate` scenarios: warm-up 10 rps for 30 s, then 25, 50, 100 and 200 rps for 60 s each (4 min 30 s plus a 10 s graceful stop). `preAllocatedVUs` 50, `maxVUs` 400. No `sleep()`: arrivals do not wait for responses.

### Rate limiter bypass (local only)

The rate limiters key on the client IP (global 300 per 15 min, public search 60 per minute). The script sends a random `X-Forwarded-For` from a pool of 5 000 private `10.77.x.y` addresses per request, and the API runs with `TRUST_PROXY=1`, so Express takes that header as the client IP and the limiters stay out of the measurement. Any 429 increments the `rate_limited` counter and fails the run, which means the trick stopped working.

`TRUST_PROXY=1` is set only on the command line of this local run. Never set it anywhere else to make this trick work: in production `TRUST_PROXY` is the real proxy hop count, and a wrong value lets clients pick their own IP and bypass the limits.

## How k6 runs

k6 runs from the pinned `grafana/k6:2.4.0` image through `infra/load/docker-compose.yml` (project `onemarketplace-load`); nothing is installed into the repo. `pnpm load:public` runs `docker compose -f infra/load/docker-compose.yml run --rm k6`.

The roadmap brief proposed `docker run --network host` with a `$PWD` volume. That does not work here: root scripts run under `cmd.exe` on Windows (no `$PWD`), and host networking on Docker Desktop does not reach the host the same way as on Linux. The compose file instead mounts `infra/load` relative to itself and reaches the API through `host.docker.internal` (mapped to `host-gateway`, so Linux works too).

Variables read by the compose file (from the shell that runs `pnpm load:public`):

| Variable   | Default                            | Meaning                                                        |
| ---------- | ---------------------------------- | -------------------------------------------------------------- |
| `BASE_URL` | `http://host.docker.internal:4000` | API origin as seen from the container                          |
| `RUN_NAME` | `public-read`                      | summary file name: `infra/load/results/<RUN_NAME>.json`        |
| `SMOKE`    | unset                              | `1` runs one `smoke` scenario at 5 rps for 10 s instead        |
| `P95_MS`   | `1000`                             | p95 threshold in ms for the whole run, per stage and per route |

Thresholds (no `abortOnFail`, a failed one makes k6 exit non-zero): `http_req_failed` rate < 1 %, `http_req_duration` p95 < `P95_MS`, `rate_limited` count < 1, `checks` (status 200) rate > 99 %, plus per-stage and per-route p95 and per-stage error rate.

## Owner steps

Use one PowerShell terminal for the API and a second one for the rest, both at the repo root. Bash variants are given where they differ. `<POSTGRES_PASSWORD>` is your `POSTGRES_PASSWORD` (`change-me` in `.env.example`). Close anything heavy (dev servers, builds, browsers with many tabs) before measuring.

### a. Start the local infrastructure

```powershell
pnpm infra:up
```

### b. Create the load database

```powershell
docker exec onemarketplace-postgres psql -U onemarketplace -d postgres -c "CREATE DATABASE onemarketplace_load"
```

### c. Run the migrations against it

The `db:migrate` script loads the root `.env` with `--env-file`, but a variable already set in the shell wins over the file, so the value below is used. Only ever point this at the local Docker database, never at a remote one.

```powershell
$env:DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load"
pnpm --filter @onemarketplace/api db:migrate
Remove-Item Env:DATABASE_URL
```

Bash:

```bash
DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load" pnpm --filter @onemarketplace/api db:migrate
```

### d. Seed it

The seed refuses to run in any database other than `onemarketplace_load`: it sets `ON_ERROR_STOP` itself, checks the database before the transaction, and checks again inside it, so even a run without the flag rolls back. Copy the file into the container first so the shell does not re-encode it (the seed contains en dashes, which Windows PowerShell 5.1 pipes would mangle). The same commands work in PowerShell and bash:

```powershell
docker cp infra/load/seed/seed.sql onemarketplace-postgres:/tmp/seed.sql
docker exec onemarketplace-postgres psql -v ON_ERROR_STOP=1 -U onemarketplace -d onemarketplace_load -f /tmp/seed.sql
docker exec onemarketplace-postgres rm /tmp/seed.sql
```

In Git Bash on Windows, run `export MSYS_NO_PATHCONV=1` first; otherwise Git Bash rewrites `/tmp/seed.sql` into a Windows path and psql cannot find the file.

### e. Build the API

```powershell
pnpm --filter @onemarketplace/api build
```

### f. Start the API from `dist` (API terminal)

Configuration `off` (telemetry off), with the run name in the log file name:

```powershell
$env:DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load"
$env:TRUST_PROXY="1"
$env:TELEMETRY_MODE="off"
pnpm --filter @onemarketplace/api start *> infra/load/results/api-off-1.log
```

Configuration `otlp` (telemetry exported to the local Grafana stack): run `pnpm infra:obs:up` once in the other terminal, then

```powershell
$env:DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load"
$env:TRUST_PROXY="1"
$env:TELEMETRY_MODE="otlp"
pnpm --filter @onemarketplace/api start:observed *> infra/load/results/api-otlp-1.log
```

Replace `off-1` and `otlp-1` in the log file names with the current `RUN_NAME` (`api-<RUN_NAME>.log`).

Bash, configuration `off`:

```bash
DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load" TRUST_PROXY=1 TELEMETRY_MODE=off \
  pnpm --filter @onemarketplace/api start > infra/load/results/api-off-1.log 2>&1
```

Bash, configuration `otlp` (after `pnpm infra:obs:up`):

```bash
DATABASE_URL="postgresql://onemarketplace:<POSTGRES_PASSWORD>@localhost:5432/onemarketplace_load" TRUST_PROXY=1 TELEMETRY_MODE=otlp \
  pnpm --filter @onemarketplace/api start:observed > infra/load/results/api-otlp-1.log 2>&1
```

Wait until `GET http://localhost:4000/api/v1/ready` answers 200. When you close the API terminal, the `$env:` values go with it; in a terminal you keep, clear them with `Remove-Item Env:DATABASE_URL, Env:TRUST_PROXY, Env:TELEMETRY_MODE`.

### g. Smoke, then three runs per configuration

Smoke first (10 s at 5 rps, must exit 0):

```powershell
$env:SMOKE="1"; $env:RUN_NAME="smoke"; pnpm load:public; Remove-Item Env:SMOKE
```

Bash: `SMOKE=1 RUN_NAME=smoke pnpm load:public`

Then the full runs, `off-1`, `off-2`, `off-3`, and after switching the API to `otlp`, `otlp-1`, `otlp-2`, `otlp-3`:

```powershell
$env:RUN_NAME="off-1"; pnpm load:public
```

Bash: `RUN_NAME=off-1 pnpm load:public`

Rule for every run: restart the API before each run (stop it with Ctrl+C and start it again as in step f with the matching log name), so every run starts from a fresh process and the warm-up stage covers JIT and pool warm-up the same way each time. Then let the machine idle for about one minute before `pnpm load:public`. A non-zero exit means a threshold failed; the run still counts as data, note which threshold failed.

### h. Read the results

Each run writes `infra/load/results/<RUN_NAME>.json` (git-ignored; k6 also prints the summary). Under `metrics`, the keys that matter are:

- per stage: `http_req_duration{scenario:<stage>}` with `med` (p50), `p(95)`, `p(99)`; `http_req_failed{scenario:<stage>}` with `value` (error rate); `http_reqs{scenario:<stage>}` with `count`; `dropped_iterations{scenario:<stage>}` with `count` (arrivals k6 could not start, a sign the API or the VU pool could not keep up). Stages: `warmup`, `rps_25`, `rps_50`, `rps_100`, `rps_200`.
- achieved rps of a stage is `count / stage seconds` (30 for `warmup`, 60 for the others). The `rate` field of a sub-metric divides by the whole test duration and is not the stage rate.
- per route: `http_req_duration{route:feed}`, `{route:freelancer_search}`, `{route:agency_search}`, `{route:ready}`.
- whole run: `http_req_duration`, `http_req_failed`, `checks`, `rate_limited` (absent or 0 when no 429 happened).

### i. Pool waiting and event-loop delay (otlp runs only)

Open Grafana at `http://localhost:3010` (local `admin`/`admin`), Explore, data source Prometheus. The API exports every 10 s. Set the time range to the run (k6 prints start and end; the stages start at +0 s, +30 s, +90 s, +150 s and +210 s) and query:

```promql
max_over_time(db_pool_waiting{service_name="onemarketplace-api"}[1m])
max_over_time(nodejs_eventloop_delay_p99_milliseconds{service_name="onemarketplace-api"}[1m])
```

`db.pool.waiting` (clients waiting for a pool connection) and `nodejs.eventloop.delay.p99` (ms, reset after each export, so each sample is the p99 of the last 10 s) are the OpenTelemetry names from ADR 0026; Prometheus replaces dots with underscores and adds the unit suffix `_milliseconds` to the event-loop gauge. Record the maximum within each stage window. With telemetry off these gauges do not exist: write "not measured".

### j. Thresholds

`P95_MS` changes the p95 threshold (default 1000 ms, a placeholder). A forced low threshold on the smoke must exit non-zero:

```powershell
$env:SMOKE="1"; $env:P95_MS="1"; $env:RUN_NAME="smoke-low"; pnpm load:public; Remove-Item Env:SMOKE, Env:P95_MS
```

Bash: `SMOKE=1 P95_MS=1 RUN_NAME=smoke-low pnpm load:public`

After the first accepted baseline, the policy is 1.5 times the measured median p95 per stage as a regression guard (ADR 0027).

### k. Cleanup

Stop the API (Ctrl+C), then `pnpm infra:obs:down` if it was started, then drop the load database:

```powershell
docker exec onemarketplace-postgres psql -U onemarketplace -d postgres -c "DROP DATABASE onemarketplace_load"
```

## Linux note

The container runs as uid 12345. On Docker Desktop (Windows, macOS) the bind mount accepts its writes. On Linux, `infra/load/results/` must be writable by that uid, for example `chmod o+w infra/load/results`, otherwise k6 cannot write the summary file. k6 creates the file but not the folder, which is why `results/.gitkeep` is tracked.
