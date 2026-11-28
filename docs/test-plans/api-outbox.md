# Operator note: notification outbox, shadow to on

## Scope

`OUTBOX_MODE` for the eight best-effort notices (ADR 0029, roadmap 1.4): CONTRACT_ACCEPTED, MILESTONE_ADDED, CONTRACT_COMPLETED, REVIEW_RECEIVED, PROPOSAL_RECEIVED, PROPOSAL_VIEWED, the answered-invitation notice (AGENCY_INVITATION_ACCEPTED or DECLINED) and AGENCY_WELCOME_BONUS. Rollout per D-4: `shadow` for one week, then `on`. Every mode behaves as `off` while `RABBITMQ_URL` is unset.

Use throwaway credentials only. Never print or paste the real `.env`. Read tables with `psql` inside the Postgres container or a local client; do not put connection strings with passwords on a command line you share.

## Modes

| Mode     | Request path                                                                           | Relay                       | Expected duplicates                                      |
| -------- | -------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `off`    | direct publish after commit, as before (the envelope id is now deterministic)          | not started                 | none                                                     |
| `shadow` | row inserted in the business transaction (or right after the write) and direct publish | publishes every row as well | each notice reaches the broker twice, stored once        |
| `on`     | row only; no direct publish                                                            | publishes every row         | only after a crash between publish and mark; stored once |

## Signals

| Signal                         | Kind            | Meaning                                                                                           | Action                                                         |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `outbox.event.dead`            | log, error      | a row gave up after 10 failed publishes, or its payload was invalid                               | alert; read `last_error` of the `DEAD` row; the notice is lost |
| `outbox.relay.lag`             | log, warn       | the oldest pending row is older than 60 s (at most once a minute)                                 | check the broker connection and `outbox.relay.failed`          |
| `outbox.relay.failed`          | log, error      | a relay tick threw (usually a database error)                                                     | check Postgres; rows wait for their 60 s lease                 |
| `outbox.enqueue.failed`        | log, warn       | a post-commit enqueue (proposal viewed, invitation answered, welcome bonus) failed; sent directly | check Postgres; the notice went the old way                    |
| `outbox.relay.lease_lost`      | log, warn       | a result was not recorded because the row was reclaimed                                           | rare; frequent means sends take longer than the lease          |
| `outbox.relay.disabled`        | log, warn, once | the relay found RabbitMQ disabled and released rows                                               | configuration error: relay running without `RABBITMQ_URL`      |
| `queue.publish.skipped/failed` | log             | a direct publish was dropped (`off`, `shadow`) or a relay send failed (`on`, the row retries)     | in `on`, follow `outbox.pending` instead                       |
| `outbox.pending`               | gauge           | rows `PENDING` or `PUBLISHING`                                                                    | should return to 0 within seconds                              |
| `outbox.oldest_pending_age_ms` | gauge           | age of the oldest pending row                                                                     | above 60 000 means lag                                         |
| `outbox.dead`                  | gauge           | rows in `DEAD`                                                                                    | should stay 0                                                  |

Gauges exist only with `TELEMETRY_MODE` set to `console` or `otlp` and the relay running. Without telemetry, count rows instead: `select status, count(*) from outbox_events group by status;`.

## Checklist: off to shadow

| #   | Step                                                                            | Expected                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Confirm the migration `0011_outbox_events` is applied and `RABBITMQ_URL` is set | `outbox_events` exists                                                                                                                                              |
| 1.2 | Set `OUTBOX_MODE=shadow`, restart the API                                       | `outbox.relay.started` logged once                                                                                                                                  |
| 1.3 | Submit a proposal                                                               | one `outbox_events` row for the proposal (`PUBLISHED` within about 1 s); one `notifications` row for the client                                                     |
| 1.4 | Accept a contract offer                                                         | two rows (client and talent), both `PUBLISHED`; one `notifications` row per recipient                                                                               |
| 1.5 | View a proposal twice as the client                                             | one row; the second view adds nothing                                                                                                                               |
| 1.6 | Stop the RabbitMQ container for a minute, trigger 1.3 again, start it again     | the direct publish logs `queue.publish.skipped`; the row stays `PENDING`, `outbox.relay.lag` fires after 60 s, then the row is published and the notice stored once |
| 1.7 | Daily for a week: dead rows, lag and failures                                   | `outbox.dead` 0; no `outbox.event.dead`, `outbox.relay.failed` or `outbox.enqueue.failed`; pending back to 0                                                        |

## Checklist: shadow to on

| #   | Step                                                     | Expected                                                                                     |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2.1 | Week of shadow is clean (1.7)                            | go                                                                                           |
| 2.2 | Set `OUTBOX_MODE=on`, restart the API                    | relay started                                                                                |
| 2.3 | Repeat 1.3 and 1.4                                       | no `queue.publish.*` log from the request; notices arrive up to about 1 s later; stored once |
| 2.4 | Repeat 1.6                                               | no `queue.publish.skipped`; the row waits and is delivered after the broker returns          |
| 2.5 | Keep watching `outbox.event.dead` and `outbox.relay.lag` | silent                                                                                       |

## Going back

Set `shadow` or `off` only when `outbox.pending` is 0 (or `select count(*) from outbox_events where status in ('PENDING', 'PUBLISHING');` returns 0); otherwise the remaining rows wait until a relay runs again. `DEAD` rows are never retried automatically.
