# Backend evolution, stage 3: decisions and roadmap

Date: 2026-11-21. Fact base: `01-current-state.md` (inv.) and `02-evaluation.md` (eval.). Paths relative to repo root; `R/` = `services/api/src`. Planning only: no source, dependency, settings or git change was made. `.env*` and `services/api/scripts/*.ts` were not touched.

Labels: **[V]** read in code or in an installed package at a cited line. **[V\*]** read by an explorer subagent and not re-read by the author (re-read before relying on it for a money or auth change). **[D]** stated by documentation (URL). **[I]** inference from verified facts. **[A]** assumption, not verified. Nothing marked [I] or [A] in 02 was promoted without a check; where Part 1 checked one, the new label is shown.

## User input (all three are "unknown"; defaults used, and what each answer would change)

- **Hosting target and API instance count: unknown.** Default: one API instance, hosting undecided. If N>1: row 37 (Socket.IO/SSE fan-out) and row 36 (process roles) leave "defer" and join a wave; the readiness policy (decision D1) matters more; duplicate cron ticks stay money-safe (eval. C3). If a managed platform with health-based restarts: the Redis reconnect fix (row 31) becomes less critical but the 503-on-readiness question gets sharper. Row 40 (Dockerfile) and the production-edge questions (rows 25, 27) wait for this answer.
- **Realistic payout volume (candidates per hour): unknown.** Default: tens per hour. Below roughly 100 per hour row 42 is insurance (backlog after an outage, head-of-line blocking), not a daily problem. Every candidate costs at least one sequential Stripe call before the claim and up to three on recovery (eval. A3); at a few hundred per hour the run approaches the hourly tick [I, per-call latency not measured]. Volume sets `PAYOUT_BATCH_SIZE`, the tick budget and the cap in Part 4.
- **Agent sessions per week for backend: unknown.** Default: 2 per week next to the frontend migration. Wave 1 is about 8 sessions (about 4 weeks at the default; 8 weeks at 1 per week). Cut order if time is short: keep 31, D-1, 42; then 32; then 43; then 18.

## Part 1. Leftovers from 02 (read only)

### 1.1 `claimableCondition` and the payout candidate set

- Filter [V\*] (`R/modules/payouts/repositories/payouts.repository.ts:19-36`, sources from `R/modules/payouts/utils/payouts.state.ts:15-17`): `status='PENDING'`, or `status='FAILED' AND next_retry_at IS NOT NULL AND next_retry_at <= now()`, or `status='PROCESSING' AND claimed_at < now() - 15 min` (stuck claim, `payouts.state.ts:10`). `findClaimableCandidates(executor)` (`:171-197`) takes no filter and no limit, orders only by `created_at ASC` (no primary-key tiebreak) and drops earnings of CANCELLED contracts (`:189-194`).
- Index [V\*]: partial `payout_history_open_idx (status, COALESCE(next_retry_at, claimed_at)) WHERE status IN (PENDING, PROCESSING, FAILED)` (`R/modules/payouts/models/payouts.model.ts:54-59`, `drizzle/0001_thin_iron_fist.sql:13`). It does not serve `ORDER BY created_at`.
- Producers [V\*]: `insertPendingPayoutsForDueEarnings` (`payouts.repository.ts:149-169`) inserts one PENDING row per earning older than the hold cutoff; earnings are written per milestone release (`R/modules/contracts/services/contracts.milestones.service.ts:192`). No business cap exists. `PAYOUT_MAX_ATTEMPTS` is 5 (`payouts.failure.ts:1`).
- **Can the set be large?** Yes, unboundedly in principle: it holds every due PENDING, FAILED-and-due and stuck row. Steady state is small; it grows after a Stripe or account outage. [I] New: per candidate `processCandidate` first calls Stripe `accounts.retrieve` and skips the row when transfers are not active or the call errors (`payouts.service.ts:344`, helper `:167-192`) [V\*]. A skipped row stays PENDING, so it is re-checked (one Stripe call) on every hourly tick forever. Rows for accounts that never become payable therefore accumulate and lengthen every run.
- Loop [V\*]: `processDuePayouts` (`payouts.service.ts:466-509`): sweep wrapped in try/catch (`:467-475`); `createDueRows` (`:476`) and `selectCandidates` (`:477`) are not wrapped, so a throw there aborts the run; the per-candidate loop (`:483-502`) is try/catch, so one failure does not stop the others. No time bound. Cron hourly, `noOverlap: true` (`payouts.cron.ts:6,38-41`).
- **Consequence for row 42:** a plain `LIMIT n ORDER BY created_at` is wrong, because permanently skipped old rows would fill every batch and starve newer rows (head-of-line blocking). The design needs a keyset cursor inside the tick (Part 2, Part 4).
- Tests that exist [V\*]: `payouts/tests/payouts.{cron,failure,integration,repository.guard,state}.test.ts`; none named for the service.

### 1.2 Proposal double submit

- Protected [V\*]: unique index `proposal_sender_job_unique (sender_id, job_id)` (`R/modules/proposals/models/proposals.model.ts:38`, `drizzle/0000_init.sql:494`). Insert uses `.onConflictDoNothing()` with no conflict target (`proposals.repository.ts:81`). Freelancer path: `debitConnects` (guarded UPDATE, `connects.repository.ts:28`), insert, then `ApiError(409, "You already submitted a proposal for this job.")` inside the same `db.transaction` (`proposals.submission.service.ts:55,63,75-76,92`), so the debit and history roll back [I]. Agency path same shape (`:155,163,175-179`). Test: `proposals.contract.test.ts:906-925` (sequential only). No concurrent-submit test.
- **Contradicts 02 C2** ("proposal submit protection not verified"): it is protected by a unique constraint. Proposal submit does not need an `Idempotency-Key`; row 34 narrows to Stripe checkout creates.
- Caveat [V\*]: the 409 covers any swallowed conflict, not only this index (no `isUniqueViolation`). New finding, linked to row 31: the connects cache `setEx` runs after commit with no try/catch (`proposals.submission.service.ts:94,199`), so a Redis error returns 500 for a proposal that is saved and charged; the client retry then gets 409.

### 1.3 `contracts.webhook-context.ts` and `insertContractNotice`

- [V\*] `insertContractNotice` (`R/modules/contracts/utils/contracts.notices.ts:21-35`) builds the id with `notificationEventId(type, entityId, transition)` = `uuidV5("kind:entityId:transition")` (`notification-store.event-id.ts:14-25`), e.g. funded notice with the milestone id (`contracts.checkout.service.ts:522-536`). `insertNotification` uses `onConflictDoNothing` on `event_id` (`notification-store.repository.ts:10-25`) and returns null on a duplicate; the push runs only for a non-null row (`contracts.notices.ts:39-41`).
- `contracts.webhook-context.ts:1-16` is an `AsyncLocalStorage` holding the Stripe event id, set at `contracts.webhook.service.ts:25`; it is used only for logs and refunds (`contracts.checkout.service.ts:108-127`), not for the notice id.
- **Duplicate-safe: yes** [V\*]: same id, no second row, no second push, no throw. Closes 02 A2 gap (5, part 1). Not read: whether a duplicate returns before reaching the notice (irrelevant to safety).

### 1.4 `connects_id` subquery (connects.repository.ts:186)

- [V\*] The insert takes `connects_id` from `(select connects.id from connects where freelancer_id = $id)` (`:186`; agency `:209`); the column is NOT NULL (`R/modules/connects/models/connects.model.ts:55-57`). I re-read the service [V, `R/modules/connects/services/connects.service.ts:147-227`]: `createConnectsCheckout` does not ensure a balance row (`:155-192`); `completeConnectsPurchase` inserts the purchase first (`:201`), then `creditConnects`, and throws `ApiError(404)` when no row is updated (`:216`). Balance rows are created only at onboarding (`addConnects`, `:42-64`, called from `freelancer.profile.service.ts:328` [V\*]).
- **Verdict: real latent defect (item D-1).** For an account with no balance row (never onboarded or created before the feature) a paid checkout gives a NOT NULL violation, a 500 to Stripe, and a retry loop until Stripe stops retrying; the customer paid and gets nothing. How many accounts lack a row is unknown [A]; only a data check by the user (a read-only count) answers it.
- Contradicts 02 only by promoting its open point "(5) connects_id may be null" from [A] to [V\*] (null is possible; reachability [A]).

### 1.5 RabbitMQ image tag and the delivery bound

- Tag [V\*]: `rabbitmq:4.4.0-management-alpine` in `infra/docker/docker-compose.yml:51` and `.github/workflows/ci.yml:91`.
- Queue [V\*] (`R/infrastructure/events/notification.topology.ts:30-39`): quorum, `x-delivery-limit` 5, DLX `notifications.dlx`, `at-least-once` dead-lettering, `reject-publish`.
- Consumer [V\*] (`R/modules/notifications/notifications.consumer.ts`): permanent = SQLSTATE `/^2[23]/` (`:22-23`); invalid JSON or envelope `nack(false,false)` (`:146`); insert failure increments an in-memory per-envelope counter (`:38,171-172`), map capped at 1000 with FIFO eviction (`:20,179-180`); `nack(msg,false, !(exhausted||permanent))` (`:185`); every non-permanent error also pauses the consumer (`:183`).
- **Real bound for a transient poison message: the in-memory counter**, 5 attempts per envelope id per process; it resets on restart and FIFO eviction at 1000 ids can reset it. ADR 0004:41-43 states that on 4.4 a nack with requeue does not increment the quorum delivery count ("verified experimentally") [V\* that the ADR says so]. No script or artifact in the repo reproduces that experiment [V\*]; official docs say the same for 4.3+ [D] https://www.rabbitmq.com/docs/quorum-queues. The real-broker test (`rabbitmq.client.integration.test.ts:189-202`) shows dead-lettering after repeated failure but cannot tell which bound caused it.
- **Consistent with 02 A4** (it said "may not bound"); upgraded to "the counter is the only bound, per ADR 0004". The residual "[I] verify on a real broker" stays open until the evidence test in item 18 exists.

### 1.6 `@opentelemetry/instrumentation-redis` vs node-redis 6.x

- `pnpm view` (read only): version 0.73.0, peer `@opentelemetry/api ^1.10.0`; the registry metadata has no readme. The GitHub README (fetched once, read only) is **self-contradictory**: intro "versions `>=2.6.0 <6`", "Supported Versions" section "`>=2.6.0 <7`"; it never mentions v6, v5 or `@redis/client` [D] https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-redis.
- **Unresolved by documentation.** 02 C1 flagged this [A]; it stays [A] until LE-1 runs a real request and checks that Redis spans appear (node-redis 6.3.1 is installed). Plan LE-1 with a fallback of manual spans around the cache helper from item 31.

### 1.7 Redis call sites (non-test) and current failure behavior

All [V\*], `R/` paths. Client: `infrastructure/cache/redis.client.ts:6-17` (strategy: 10 retries then `Error`; no command or connect timeout set in code).

1. `modules/auth/middleware/auth.middleware.ts:50 get, :69 setEx` (`isAccountAvailable`), `:53` unguarded `JSON.parse`. Via `authenticateAccount` (`:80-107`, try at `:94-106`): non-ApiError becomes **401** (callers `auth.controller.ts:47`, `messaging.socket.ts:79`). Via `loadRequestAuth` (`:145-159`; `isAuthenticated`, `identifyAccount`, `resolveAccountRole`): **500** `system.request.failed`.
2. `modules/connects/middleware/connects.middleware.ts:20 get, :24 expire, :35 setEx`, mounted on all connects routes (`connects.route.ts:21`): no try, **500**; no DB fallback.
3. `modules/connects/services/connects.service.ts`: `:36 setEx` (`cacheBalance`, after commit at `:62`, `:227`), `:87 setEx` (agency onboarding), `:100 get, :103 expire, :110 setEx` (`getAgencyConnectsBalance`), `:313 setEx` (agency purchase): none guarded; a write failure throws after commit.
4. `modules/proposals/services/proposals.submission.service.ts:94, :199 setEx` after commit, before `sendNotification`: **500 after commit**.
5. `modules/proposals/services/proposals.review.service.ts:181, :187 setEx` after commit, before the conversation emit: 500 after commit.
6. `infrastructure/cache/account-auth.cache.ts:10 del`: caught, `auth.cache.invalidate_failed`. Already fail-open (stale up to 600 s, 30 s negative).
7. `modules/meetings/services/meetings.webhook.service.ts:106-112 set NX EX` (2 s timeout, `!isReady` guard), `:122-123 del`: caught, `webhook.inbound.dedupe_unavailable`. Already fail-open.
8. `modules/health/services/health.service.ts:55-67`: `!isOpen || !isReady` throws, then `ping()`; 2 s per check; result `ok|failed`; controller answers 503 unless both ok (`health.controller.ts:37-40,67`). Liveness does not touch Redis.
9. `modules/admin/services/admin.system.service.ts`: `:19 ping` (in `allSettled`, logs `admin.health.redis_failed`, no 500); `:83 scan, :91 type/ttl`, `:105-136 type/get/hGetAll/lRange/sMembers/zRangeWithScores/ttl`: no try, **500**.
10. `middleware/utils/redis-rate-limit-store.utils.ts:91 eval, :107 eval (DECR), :118 del`: 500 ms timeout, `!isReady` guard, caught, `rate_limit.store.error` at most once a minute, falls back to `MemoryStore`. Already fail-open.
11. `bootstrap/start.ts:47` `connectRedis` before listen; failure logs `system.startup.failed`, exits 1. 12. `bootstrap/shutdown.ts:208` `disconnectRedis` (`quit` only when `isOpen`).

- Net: two classes of defect: **reads on the request path fail closed** (sites 1, 2, 3 read, 9) and **post-commit cache writes throw after the business effect** (sites 3, 4, 5). Sites 6, 7, 8, 10 are correct. 55 test files mock `redis.client` with only the methods they use and no `isReady`/`isOpen` [V\*]; new code must tolerate those mocks.

## Part 2. Decisions

Categories from 02: Implement Now rows 18, 31, 32, 42, 43; Learning Experiment rows 20, 21, 22, 34, 38 (webhook), 41. Final decision: **do / defer / drop**.

| Row                                      | Decision              | One-line reason                                                                                                                                  |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 31 Redis fail-open + reconnect           | **do, wave 1A**       | Any Redis error 500s authenticated routes and the client never recovers after about 15 s (eval. A1, A6); plus post-commit write 500s (1.7)       |
| 32 Timeouts (Daily, ImageKit)            | **do, wave 1A**       | Daily has none (`daily.client.ts:21`); ImageKit has none; Clerk has no SDK option, so Clerk is deferred to row 43's removal of the fan-out       |
| 42 Bound payouts                         | **do, wave 1C**       | Unbounded read plus accumulating skipped rows (1.1); money path, so extra verification                                                           |
| 43 Admin display names                   | **do, wave 1B**       | Removes per-row Clerk fan-out, matches the AGENTS.md rule, no webhook needed (eval. C4)                                                          |
| 18 DLQ visibility                        | **do, wave 1B**       | Nobody reads `notifications.dead` (eval. A4); small and low risk; includes the evidence test for 1.5                                             |
| 20/21/22 OpenTelemetry (traces, metrics) | **defer to wave 2**   | Valuable only with a viewer; do as LE-1 after 31 so the new log events become counters; redis README unresolved (1.6)                            |
| 41 Load-test baseline                    | **defer to wave 2**   | Highest-value measurement, but needs a tool install (your approval) and is more meaningful after 31 and 42                                       |
| 34 Idempotency-Key                       | **defer (LE-2 only)** | Proposal submit is already protected (1.2); duplicates of checkout creates cost nothing until paid and the webhook guards refund them (eval. A2) |
| 38 Clerk webhook projection              | **defer (LE-3 only)** | The read model exists (ADR 0019); row 43 fixes the pain; the layer-ownership cost (eval. C4) is not justified without a staleness incident       |
| D-1 (new, from Part 1.4)                 | **do, wave 1B**       | Paid purchase can be lost for accounts without a balance row                                                                                     |

### Contested rows: options and recommendation

**Row 31, reconnect strategy** (the call-site policy is fixed in Part 4):

- A. Library default (retry forever). Least code; but `connect()` at boot then never rejects, so the process hangs instead of exiting 1 when Redis is absent.
- B. Own strategy, retry forever, exponential delay 100 ms doubling to a 5 s cap plus 0 to 100 ms jitter, and a 15 s deadline on the initial `connect()` so a missing Redis at boot still exits 1 (current behavior). Testable as a pure function. **Recommended.**
- C. Keep 10 attempts and add a supervisor that calls `connect()` again on `terminated`. More moving parts and a window where every command fails; no benefit over B.
- Also set `disableOfflineQueue: true` [A: option name and v6 semantics to be confirmed in the installed typings] so commands during a reconnect fail at once instead of waiting 5 s (eval. A6), plus a 300 ms application timeout on cache reads (rate-limit store already uses 500 ms).

**Row 18, DLQ**:

- A. Runbook only (docs). Zero code, still blind.
- B. Periodic depth check on a dedicated channel plus warn log `queue.dead_letter.nonempty`, runbook, and an evidence test for the delivery-count claim. **Recommended**: one small file, no migration, uses the existing log-based alerting convention.
- C. DLQ consumer persisting dead messages to a table with an admin replay route. Migration, new route, openapi change; revisit only if dead letters actually appear.

**Row 42, payout batching**:

- A. `LIMIT n` per tick. Smallest change, but starves newer rows behind permanently skipped ones (1.1).
- B. Keyset cursor `(created_at, id)` batches inside one tick, wall-clock budget and a per-tick cap, no migration. Every row is looked at once per tick; skipped rows cannot block. **Recommended.**
- C. Add a `next_check_at` (or reuse `next_retry_at`) set when an account is not transfer-active, so skipped rows leave the hot set. Cleanest long term, but a migration plus a state-machine change on a money table; take it only if the cap-hit log fires.

**Row 34, Idempotency-Key**:

- A. Do nothing in production; LE-2 prototype only. **Recommended** (value is UX, not money safety, eval. C2).
- B. Server-side derived Stripe key on checkout creates (account + plan or milestone + 10-minute bucket); no new header, no table, no frontend change. Candidate to evaluate inside LE-2 because it is far cheaper than C; risk: Stripe rejects a reused key with different parameters.
- C. Full Postgres `http_idempotency` table, middleware, 409/422 responses, api-client changes. Highest cost, openapi changes.

**Row 38, projection**:

- A. Row 43 only (admin reads stored names). **Recommended.**
- B. Redis cache-aside for Clerk names. Adds a second copy and the Redis failure class of row 31; drop.
- C. Clerk webhook projection (LE-3). Only after a real staleness complaint.

### Decisions for you (with defaults)

- **D1. Readiness while Redis is down.** Default: keep `GET /ready` answering 503 (unchanged, no openapi change). Row 31 makes the API usable without Redis, but a health-checking orchestrator would still pull it. Alternative: report `redis: "degraded"` with 200, which changes the `CheckStatus` enum (`R/modules/health/services/health.service.ts:4-9`, responses file) and regenerates openapi. Decide when hosting is known.
- **D2. Purchase with a missing balance row.** Default: create the row with 0 Connects inside the purchase transaction, then credit (no welcome bonus). Alternative: refund the session.
- **D3. Payout limits.** Default: batch 50, per-tick cap 500, budget 45 minutes of the hour. Change after you give the volume.
- **D4. Admin email.** Default: admin lists show the stored `accounts.email` (written at profile sync), not a live Clerk lookup.
- **D5. Read-only data check (yours to run).** Count of freelancer and agency accounts with no balance row (D-1 reach), and PENDING payout rows older than 7 days (1.1). Default: skip; fix anyway.
- **D6. ADRs.** Default: new ADR 0025 (cache fail-open and reconnect), update ADR 0004 (item 18: version 2, delivery-count evidence, monitor), update the payouts ADR (item 42; find it with a grep of `docs/decisions`).
- **D7. Lab installs.** Default: nothing is installed until you approve each lab's dependencies; labs are never added to `pnpm-workspace.yaml`.

## Part 3. Roadmap

Sizes are agent sessions. All implementation by Sonnet (`backend` agent), one `reviewer` pass per item, `test-runner` for gates. Opus is used only if a plan needs redesign. No wave changes `docs/api/openapi.json` (expected unchanged; the drift check must prove it), none needs `.claude/settings.json` or a dependency change.

### Waves and dependencies

- **Wave 0 (you, 1 short session):** answer D1 to D7, optionally run the D5 counts. Blocks nothing technical; D3 blocks 42's constants.
- **Wave 1A: rows 31 and 32.** Independent of each other (different files). 31 first. Blocks: LE-1 (needs the new events) and wave 2.
- **Wave 1B: D-1, 43, 18.** Independent of 1A and of each other. D-1 should not wait: it is a paid-money defect.
- **Wave 1C: row 42.** After 1A/1B only to keep sessions fresh; no technical dependency. Blocks LE-4 interpretation.
- **Wave 2 (labs, outside `services/api`):** LE-4 then LE-1; needs wave 1A and 1C done. LE-5 and LE-2 may start any time.
- **Wave 3 (conditional on evidence, none scheduled):** rows 33, 36, 37, 39, 40, 9, 17, 35 per the "Considered later" triggers below.

### Per item

| Item | Size | Model                                                  | Tier                                                        | ADR                                            | Migration | openapi                               | User action                                                                          | Rollback                                                          |
| ---- | ---- | ------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------- | --------- | ------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 31   | 2    | Sonnet (+reviewer)                                     | 1, then 2 (touches auth); mutation check on the DB fallback | new 0025                                       | no        | unchanged                             | commit; D1                                                                           | revert the commit; behavior returns to today's                    |
| 32   | 1    | Sonnet                                                 | 1                                                           | no (note in ADR 0021 if meetings text changes) | no        | unchanged                             | commit                                                                               | revert the commit                                                 |
| D-1  | 1    | Sonnet                                                 | 1, then 2 (money); mutation check                           | no                                             | no        | unchanged                             | D2; commit; optional D5 count                                                        | revert; stuck Stripe events resume failing as before              |
| 43   | 1    | Sonnet                                                 | 1                                                           | no                                             | no        | unchanged (admin response shape kept) | D4; commit                                                                           | revert the commit                                                 |
| 18   | 1    | Sonnet                                                 | 1 (real-broker test needs Docker RabbitMQ)                  | update 0004                                    | no        | unchanged                             | commit; configure a log alert on `queue.dead_letter.nonempty` where logs are shipped | revert; monitor is a timer only                                   |
| 42   | 2    | Sonnet; Opus optional for the review of the money path | 1, then 2; mutation checks                                  | update payouts ADR                             | no        | unchanged                             | D3; commit                                                                           | revert; unprocessed rows stay PENDING and are picked up next tick |

User actions common to all: the user commits (`/commit-plan`), runs the Tier 2 full suite before committing the last item of a wave, and runs `pnpm infra:up` for the RabbitMQ test in 18.

### Interleaving with the frontend migration

- **No hard blocker** for freelancer 4a to 4f, agency or landing: no wave changes a response shape or route, so `packages/api-client/src/generated/*` does not change.
- **Soft ordering [A: the contents of sub-batches 4a to 4f were not read]:** land 31 and D-1 before the freelancer sub-batch that first exercises Connects checkout, proposals or the auth/status and socket handshake, because those are the paths whose Redis failure answers 500 or 401 and that a fresh dashboard will surface as "signed out". 43 touches only admin (already migrated). 42, 18, 32 are invisible to apps.
- Rule: one backend wave per session, never in the same session as a frontend batch; update `docs/frontend-migration-plan.md` Status only when a frontend batch lands (not for backend waves). If an item changes a status code or message a client branches on, update `docs/frontend-integration-notes.md` in the same session (31 changes 500/401 to success; 32 adds 502 on Daily failure).
- Calendar default (2 sessions per week): week 1: 31; week 2: 32 + D-1; week 3: 43 + 18; week 4: 42. Frontend batches proceed in the other sessions.

### Deliberately NOT done, and what would reopen each

- Fastify or second framework (1): a load test on production-like hardware showing the HTTP layer, not Postgres, Stripe or serialization, dominating CPU.
- BFF (2): measured screens needing many round trips, or a need to keep tokens out of the browser.
- Microservices or API/worker split (36): a module with proven different scaling or failure isolation; or N>1 instances plus a fan-out solution for realtime (eval. C3).
- CQRS or read models beyond ADR 0019 (3, 13): a measured slow query that an index cannot fix.
- Circuit breaker and bulkhead libraries (4, 6) and a second pg pool (33): metrics showing repeated slow dependency failures or `pool.waitingCount` queueing (LE-4/LE-1 produce this evidence).
- Shared retry policy (5): a second dependency that needs retried writes with stable keys; today Daily room creation and ImageKit uploads must not retry.
- Outbox table and relay (9): a recorded loss of one of the 8 `sendNotification` kinds (`queue.publish.skipped` or `queue.publish.failed` in production logs) or a decision to make them must-not-lose.
- Retry/delayed queues (17): dead letters appearing in the item 18 monitor with transient causes.
- Inbox table (10), unit-of-work (11), saga (12), optimistic locking and 40001 retry (15), pessimistic locking change (16), distributed lock (28), Stripe event-id dedupe (35): a duplicate effect observed in production, or an isolation level being introduced.
- Materialized views, read replicas (13, 14): measured read load on the primary.
- Worker threads, job queue (23, 24): measured CPU stall from PDF generation or a cron run exceeding its interval after row 42.
- API gateway (25), email delivery (29), error tracking vendor (27): hosting and product decisions, not backend defects.
- Socket.IO/SSE adapter (37): a second API instance is planned.
- Direct-to-ImageKit uploads (39): upload latency or API memory pressure shown by LE-4.
- Dockerfile and image in CI (40): hosting target chosen.
- Schema versioning work (19): only the doc fix is folded into item 18.
- Freelancer profile N+1 (44): a slow profile endpoint in LE-4.
- Rate limiting, cache-aside, pessimistic locking (7, 8, 16): exist; row 8's defect is row 31.

## Part 4. Implementation specs, wave 1

Conventions for every item: read `docs/architecture.md`, `services/api/AGENTS.md` and the module fully first; ESM, `@/` imports, `.js` suffixes, no comments, kebab-case; no `console.*`; log with `logger.<level>({ message, eventName, attributes })` (`R/config/logger.ts:8-12`); event names are dotted lowercase and convention only; tests next to the module in `tests/`; the file-naming tests (`infrastructure-layout.test.ts`, `module-layout.test.ts`) decide new file names, read them first. Done for every item: affected module tests, API typecheck, eslint 0 errors on touched files, prettier check, `openapi:generate` leaving `sha256sum docs/api/openapi.json` unchanged, reviewer pass, report with FILES FOR ME TO DELETE (expected none).

### 31. Redis fail-open and reconnect

**Files:** `R/infrastructure/cache/redis.client.ts`; new `R/infrastructure/cache/fail-open.cache.ts` (precedent `account-auth.cache.ts`; adjust name to what `infrastructure-layout.test.ts` accepts); `R/infrastructure/constants/index.ts` (constants); `R/modules/auth/middleware/auth.middleware.ts`; `R/modules/connects/middleware/connects.middleware.ts`; `R/modules/connects/services/connects.service.ts`; `R/modules/connects/index.ts` (export two balance-cache helpers); `R/modules/proposals/services/proposals.submission.service.ts`; `proposals.review.service.ts`; `R/modules/admin/services/admin.system.service.ts`; `R/bootstrap/start.ts` (only if the startup deadline needs it); docs: ADR 0025, `docs/frontend-integration-notes.md`, `services/api/AGENTS.md` Rules line on Redis.

**Client (`redis.client.ts`):**

- Export `redisReconnectStrategy(retries)`: `Math.min(100 * 2 ** retries, REDIS_RECONNECT_MAX_DELAY_MS) + Math.floor(Math.random() * 100)`, never returns an `Error`. `REDIS_RECONNECT_MAX_DELAY_MS = 5_000`.
- `createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: redisReconnectStrategy, connectTimeout: 5_000 } })`. First confirm in the installed `@redis/client` 6.3.1 typings (read only) that `disableOfflineQueue` and `socket.connectTimeout` exist and that commands on a not-ready client reject immediately; if a name differs, use the typed name and say so in the report.
- `connectRedis`: wrap `connect()` + `ping()` in a 15 s deadline (`REDIS_STARTUP_DEADLINE_MS`); on expiry reject, so `start.ts:71-83` still logs `system.startup.failed` and exits 1. Because the strategy now retries forever, `disconnectRedis` must not hang when the client is not ready: if `isReady` call `quit()`, else call the client's hard-close (`destroy()` if present in the typings; otherwise `disconnect()`).
- Listeners: keep `redis.error`; add `ready` listener that logs `cache.redis.recovered` (info) only if a degraded state was recorded since the last ready.

**Fail-open helper (`fail-open.cache.ts`):** `cacheGet(key)`, `cacheSetEx(key, ttl, value)`, `cacheExpire(key, ttl)`, each: if `!redis.isReady` act as failed at once; race the command against `CACHE_COMMAND_TIMEOUT_MS = 300`; on error or timeout return `null`/`undefined` and call `markDegraded(op, error)`. `markDegraded` logs warn `cache.redis.degraded` with `{ op, errorName }` at most once per 60 s per process (same throttle idea as `redis-rate-limit-store.utils.ts:16-31`), never the key or value. No metrics library exists; this log line plus `redis.error` is the signal (eval. C1 lists them as future counters). Mocks used by 55 existing test files expose no `isReady`: treat `isReady === undefined` as ready only when `NODE_ENV === "test"`? Do not do that; instead the helper checks `redis.isReady === false` (strict), so mocks without the property work.

**Call-site policy (numbers from 1.7):**

1. Auth `isAccountAvailable`: `cacheGet` null or a `JSON.parse` failure = cache miss, read the DB, `cacheSetEx` best effort. Outcome: no 500 from `loadRequestAuth`, no spurious 401 from `authenticateAccount`/socket handshake. Authorization is unchanged because a miss already goes to the DB.
2. Connects middleware: `cacheGet`/`cacheExpire`/`cacheSetEx`; on null read the DB balance as today.
3. Connects service: `cacheBalance`, agency `setEx` (`:87`, `:313`) become best effort; `getAgencyConnectsBalance` uses the helpers. Export `cacheFreelancerConnects(id, balance)` and `cacheAgencyConnects(id, balance)` from `connects/index.ts`.
   4/5. Proposals submit and review call those two exports instead of raw `redis.setEx` (proposals is layer 5, connects layer 1: allowed).
   6, 7, 8, 10: unchanged (already correct).
4. Admin Redis explorer (`scan`, key reads): catch and throw `ApiError(503, "Redis is unavailable.")`; `ping` unchanged.
   11/12: as in the client section.

**Error mapping:** no new codes; 500 and 401 caused by Redis disappear; admin explorer 503 uses the repo's message-only convention (code defaults to `INTERNAL_ERROR`, `ApiError` ctor `(status, message, code?, details?)`, `R/shared/errors/api-error.ts:40-53`).

**Readiness:** unchanged by default (D1): `/ready` stays 503 when Redis is not ready, liveness untouched. State this in the ADR.

**Tests to add:** (unit) `redis.client.test.ts`: strategy never returns an Error for retries 0 to 1000, caps at about 5.1 s, jitter in range; `fail-open.cache.test.ts`: get rejects, get times out (fake timers), `isReady=false` short-circuit, setEx rejects without throwing, degraded log throttled to one per window and carries no key. (Integration/contract, using the existing Map-style mocks plus a rejecting variant) auth: `redis.get` rejecting still authenticates via the DB on `isAuthenticated` routes and on `/auth/status`; connects `GET /connects`, `/connects/history` answer 200 with `redis.get` rejecting and `setEx` rejecting; proposal submit answers 201 with `setEx` rejecting and the connects debit persisted; review path same; admin `redis/keys` answers 503 when `scan` rejects. Architecture tests must pass unchanged.
**Mutation checks (auth is security-sensitive):** remove the DB fallback in item 1 and see the new auth test fail; make the helper rethrow and see the proposal test fail.
**Definition of done:** the above, plus ADR 0025 written (decision, options A to C, the sliding-TTL caveat), `docs/frontend-integration-notes.md` note that Redis loss no longer yields 500/401, openapi hash unchanged.
**What could break:** (a) stale balance: a skipped write during an outage can leave an older value that `expire` on hit keeps alive (sliding TTL, `connects.middleware.ts:24`) [I]; overspend is still blocked by the guarded debit (`connects.repository.ts:28`), only the displayed balance may lag until eviction; list this in the ADR and consider `del` on a failed write in a follow-up. (b) Tests that count `redis` calls. (c) `disableOfflineQueue` could fail the very first command if issued before ready: only `connectRedis` runs then. (d) Retry-forever with a never-recovering Redis loses nothing but logs `redis.error` repeatedly; the throttle applies to `cache.redis.degraded` only.

### 32. Timeouts for Daily and ImageKit

**Files:** `R/infrastructure/video/daily.client.ts`, `R/infrastructure/constants/index.ts`, `R/modules/meetings/services/meetings.service.ts` (`:74`), `R/infrastructure/storage/image-kit.client.ts`, tests `daily.client.test.ts`, `meetings.contract.test.ts`, `docs/frontend-integration-notes.md`.

**Behavior:**

- `DAILY_TIMEOUT_MS = 8_000`. Every `fetch` in `dailyRequest` (`:21`) gets `signal: AbortSignal.timeout(DAILY_TIMEOUT_MS)`. A timeout or non-ok response throws `DailyRequestError` (new, in `daily.client.ts`, fields `status?`, `timedOut`); callers that matched the old plain `Error` text keep working because the message format is kept.
- No retry on room creation (no idempotency key; eval. C5). The join-token path keeps its existing fallback to the stored room URL (`messaging.meeting-join.service.ts:38-52`) and gains nothing else.
- `meetings.service.ts:74`: catch `DailyRequestError` and throw `ApiError(502, "Video room could not be created.")`; log warn `video.daily.request_failed` with `{ status, timedOut }`. The room is created before the DB transaction (`:78`), so a timeout after Daily accepted the request leaves an unused private room that Daily expires (6 h TTL, `daily.client.ts:43-55`): harmless.
- ImageKit: `new ImageKit({ privateKey, timeout: IMAGEKIT_TIMEOUT_MS (30_000), maxRetries: 0 })`. Option names are in the installed typings (`@imagekit/nodejs` 7.14.0 `ClientOptions`: `timeout`, `maxRetries`, `fetch`) [V\*]; the SDK's default `maxRetries` is not read [A], hence the explicit 0 (a retried upload can create a duplicate file, eval. C5). ImageKit errors keep today's mapping (500 via `system.request.failed`); mapping them to 502 is deferred and listed in the report.
- Clerk: no timeout option exists in `@clerk/backend` 3.30.0 (`request.d.ts:44-72`) [V\*]; leave unchanged. Its one fan-out is removed by item 43.

**Tests:** `daily.client.test.ts`: stubbed `fetch` that never resolves rejects within the timeout under fake timers with `timedOut: true`; non-ok keeps the message; the signal is passed. Contract: `POST` meeting start answers 502 with the message when the mocked client rejects with `DailyRequestError`; existing tests stay green (they mock the whole module).
**Done:** above plus note in `frontend-integration-notes.md` (meeting start can answer 502).
**Could break:** the 6-hour-old expectation that a slow Daily eventually succeeds; ImageKit uploads of 14 MB over slow links exceeding 30 s (raise the constant, not remove it).

### D-1. Connects purchase when the balance row is missing

**Files:** `R/modules/connects/services/connects.service.ts` (`completeConnectsPurchase` `:195-227`, `completeAgencyConnectsPurchase` `:279-319`), tests in `connects/tests/`.
**Behavior (default D2):** at the start of the purchase transaction call `insertFreelancerConnectsIfAbsent(transaction, freelancerId, 0)` (agency: `insertAgencyConnectsIfAbsent(transaction, agencyId, 0)`), ignore the return, then run the existing purchase insert, credit and history exactly as today. Keep the 404 on a null credit as a final guard. No new route, no cache change beyond the helper from item 31 if already landed.
**Error mapping/logs:** none new; the `Payment succeeded` log is unchanged.
**Tests:** integration/contract on the webhook route: (1) freelancer without a balance row, `checkout.session.completed` credits the plan, writes one history row, answers 200; (2) the same event delivered twice credits once; (3) agency variant; (4) existing-row case unchanged. Place any test that writes PAID payout rows in `payoutTotalsFiles` (these do not).
**Mutation check (money):** remove the ensure call and see test (1) fail.
**Done:** tests green, Tier 2 (full suite) before commit, openapi hash unchanged.
**Could break:** a zero-balance row created for an account that is not a freelancer (the metadata id is trusted from our own checkout session); confirm in the report that `freelancerId` in metadata is set only by `createConnectsCheckout` (`:184-187`) [V].

### 43. Admin listings read stored display names

**Files:** `R/modules/admin/services/admin.listings.service.ts` (`clerkNames` `:35-61`, callers `:76,135,184,269`), `R/modules/auth/services/auth.display.service.ts` and `R/modules/auth/index.ts` only if email is needed, tests `admin/tests/admin.contract.test.ts`.
**Behavior:** replace `clerkNames` with `findAccountDisplays` (batched, no Clerk; exported from `auth/index.ts`, `:19-23`; admin already imports from `auth/index.js`). Name = `displayName`, else stored email, else `"Unknown"`; avatar = `avatarUrl`. First grep each caller to list which fields it reads (explorer did not). If a caller returns `email`, add `findAccountEmails(authIds)` to auth (one query on `accounts.email`, returns `Map<authId, string | null>`) and export it from `auth/index.ts`; do not widen `AccountDisplay` (other modules spread it into public responses). Remove the Clerk import from the admin listings file. Keep response shapes identical.
**Tests:** update `admin.contract.test.ts` (mock `getUser` no longer called; assert zero Clerk calls for a 100-row page); fallback cases (null name, null email); contract schemas unchanged.
**Done:** zero `users.getUser` calls in admin listings (`grep`), AGENTS.md rule now true without exception, openapi hash unchanged.
**Could break:** admin sees a stale name or email until the next profile sync (accepted, ADR 0019:6); rows with null stored names show "Unknown" instead of a live Clerk name.

### 18. DLQ visibility and delivery-bound evidence

**Files:** new `R/infrastructure/events/notification.monitor.ts` (name per `infrastructure-layout.test.ts`), `R/infrastructure/events/rabbitmq.client.ts` (expose a `notifications-monitor` channel wrapper), `R/bootstrap/start.ts`, `R/bootstrap/shutdown.ts`, `R/infrastructure/constants/index.ts`, `docs/test-plans/api-rabbitmq.md`, ADR 0004, test `rabbitmq.client.integration.test.ts`.
**Behavior:** when RabbitMQ is enabled and connected, every `DEAD_LETTER_CHECK_INTERVAL_MS = 60_000` run `checkQueue("notifications.dead")` on a dedicated channel (a failed passive declare closes only that channel) and: depth 0, no log; depth above 0, warn `queue.dead_letter.nonempty` with `{ depth }`; check failure, warn `queue.dead_letter.check_failed` throttled to once per 10 minutes. The timer is `unref`'d, started after the consumer in `start.ts`, cleared in `shutdown.ts` before the RabbitMQ close. Also log `queue.consumer.dead_lettered` with `{ reason: "permanent" | "exhausted" | "invalid", envelopeId }` where the consumer nacks without requeue (`notifications.consumer.ts:146,185`) if no equivalent exists (grep first). Without `RABBITMQ_URL` nothing starts (API must run without RabbitMQ). Runbook in `api-rabbitmq.md`: inspect `x-death`, decide replay or purge, never auto-purge.
**Evidence test (real broker, optional time-box of half a session):** declare the queue with `x-delivery-limit` 2, run a consumer with a counter limit of 100, nack-requeue a message 6 times and assert it is still on the queue and not in `notifications.dead` (shows the broker count does not bound nack loops on 4.4.0). If the topology cannot take a limit parameter without changing production code, skip and record that in the report.
**Error mapping:** none (no HTTP surface). **Update ADR 0004:** envelope version 2, the in-memory counter as the real bound with its two weaknesses (restart reset, FIFO eviction at 1000), the monitor.
**Tests:** unit for the monitor (fake channel: depth 0, depth 3, check rejects, timer cleared on stop); startup/shutdown tests updated for the new step; the integration test above.
**Done:** tests green, `pnpm infra:up` RabbitMQ run by the user, ADR and runbook updated, openapi unchanged.
**Could break:** shutdown ordering (`shutdown.ts:146-213`) if the timer is not cleared; an extra AMQP channel (low).

### 42. Bound the payout run

**Files:** `R/modules/payouts/repositories/payouts.repository.ts` (`findClaimableCandidates` `:171-197`), `R/modules/payouts/services/payouts.service.ts` (`processDuePayouts` `:466-509`), `R/modules/payouts/constants/payouts.constants.ts` (create if absent, per layout rule), tests in `payouts/tests/`, payouts ADR. No migration.
**Behavior (option B, defaults from D3):**

- `findClaimableCandidates(executor, { limit, after })`: same filter; `ORDER BY created_at ASC, id ASC`; `LIMIT limit`; when `after` (`{ createdAt, id }`) is given add `(created_at, id) > (after.createdAt, after.id)`. Return rows including `created_at` and `id`.
- `processDuePayouts`: after sweep and `createDueRows` run unchanged, loop: fetch a batch of `PAYOUT_BATCH_SIZE = 50` after the cursor; stop when empty; for each candidate check the budget (`PAYOUT_TICK_BUDGET_MS = 45 * 60_000`) and the cap (`PAYOUT_MAX_PER_TICK = 500`) before `processCandidate`; per-candidate try/catch stays; cursor = last row of the batch (skipped and failed rows advance it, so they cannot block later rows). Claim, guard and transfer logic are untouched.
- `selectCandidates`/`createDueRows` throws now log `payout.run.failed` (error) and end the run (today they abort silently up the stack; keep the rethrow so the cron wrapper behavior does not change).
  **Log events:** `payout.run.budget_exhausted` (warn, `{ processed }`), `payout.run.capped` (warn, `{ processed, cap }`; alert on it: it means a backlog or accumulated skipped rows, the trigger for option C), existing `payout.failed` unchanged. Return value gains `stoppedEarly: "budget" | "cap" | null`.
  **Tests:** repository (integration, real DB): ordering with equal `created_at` is stable by `id`; `after` skips earlier rows; filter still excludes CANCELLED contracts. Service: 120 candidates processed in 3 batches; budget reached with fake timers stops and reports `budget`; cap stops; a throwing candidate does not stop the loop; a transfers-inactive candidate does not block later rows (old skipped rows ahead of new payable ones). Any new test writing PAID rows goes in `payoutTotalsFiles` (`vitest.config.ts:4`).
  **Mutation checks (money, ordering):** drop the `id` tiebreak (equal-timestamp test fails); drop the cursor advance (duplicate processing or endless loop test fails); drop the budget check (budget test fails).
  **Done:** tests, Tier 2, reviewer pass focused on claim idempotency, openapi unchanged, payouts ADR updated.
  **Could break:** with `LIMIT`, the planner may sort the whole open set per batch because the partial index does not serve `ORDER BY created_at` [I]; fine at current sizes, measure in LE-4. If more than 500 permanently skipped rows sit ahead of newer ones, the newer ones starve (log `payout.run.capped`); that is the trigger for a `next_check_at` migration (option C), not for raising the cap.

## Part 5. Learning track (all under `labs/<name>/`, outside `services/api`, local Docker only, own `package.json`, never in `pnpm-workspace.yaml`, installs only with your approval, reversal = list the folder under FILES FOR ME TO DELETE)

Ordered by value for effort:

1. **LE-4 load-test baseline.** Highest value: every performance claim is unmeasured (inv. §11) and it decides rows 33, 14, 37, 39, 44. Needs a tool choice and install approval. Do after 1A and 1C so the numbers do not measure the defects just fixed; record `pool.waitingCount`, p95 and error counts, local numbers only.
2. **LE-5 resilience comparison (cockatiel vs opossum).** Cheap, standalone, teaches timeout/retry/breaker/bulkhead; low production relevance until metrics show a need. Can run before wave 1 if sessions are spare; better after 32 so the real timeouts are known.
3. **LE-2 Idempotency-Key prototype.** Moderate effort, isolated Express + Postgres sandbox; include the cheap derived-Stripe-key variant (option B of row 34). Independent of the waves.
4. **LE-1 OpenTelemetry.** High learning value but best after 31, so the cache and queue log events exist and map to counters; first step: send one request and check whether Redis spans appear for node-redis 6.3.1 (1.6 is unresolved), whether Express 5 spans are duplicated (eval. C1) and that `db.statement` does not capture values. Needs install approval.
5. **LE-3 Clerk projection.** Last: depends on 43 being done, needs Clerk webhook documentation (outside the sources used so far), and the layer-ownership design is the real cost (eval. C4). Only against recorded sample payloads, no live writes.

Better after wave 1: LE-4, LE-1, LE-3. Free to start earlier: LE-5, LE-2.

## Contradictions of 02 found in Part 1

- C2's "proposal submit unique-constraint protection not verified": it is protected (1.2); row 34 no longer lists proposal submit.
- A2 gap (5), `connects_id` may be null: confirmed possible and a real latent defect (1.4), not just a risk.
- A3 "whether `claimableCondition` bounds the candidate set": it does not; new finding that skipped rows accumulate and make a plain LIMIT unsafe (1.1).
- A1 understated row 31: besides read paths, post-commit cache writes also 500 after the business effect (1.7).
- C1 open point on `instrumentation-redis` support for node-redis 6.x is not answerable from documentation (the README contradicts itself, 1.6).
- A4: not contradicted; the in-memory counter is the only bound, as ADR 0004 already says.

## Unrelated findings (not part of this plan)

1. `insertProposalIfAbsent` uses `onConflictDoNothing()` without a conflict target, so any unique conflict returns the same 409 text (`proposals.repository.ts:81`).
2. ADR 0004 still documents envelope version 1 (code: 2); folded into item 18's ADR edit.
3. Connects ignores `checkout.session.async_payment_succeeded` while contracts handles it (eval. A2); irrelevant for card-only payments [A].
4. Identity webhook answers 400/404 on bad metadata so Stripe retries a permanent failure (eval. A2); no money impact.
5. `docs/test-plans/api-rabbitmq.md` marks the delivery-limit tests (5.1, 5.2) as manual only (`:49-54`).
