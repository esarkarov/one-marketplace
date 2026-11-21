# Backend evolution, stage 1: current state of services/api

Scope: a verified inventory of `services/api`. No recommendations. Paths are relative to the repo root; `api/` stands for `services/api/`. Date: 2026-11-21.

Evidence method: four read-only explorer passes (grep and ranged reads) plus a second read by the author of the items marked `[v]`. Unmarked evidence is explorer-reported and was not re-read. Counts come from grep and are approximate where stated. Nothing was run, started or installed; `.env*` files were not read. Anything not verified is under "Unknown" in its section.

## 1. Modules, layers and boundaries

- 16 modules in `api/src/modules`: admin, agency, auth, client, connects, contracts, freelancer, health, identity, jobs, meetings, messaging, notification-store, notifications, payouts, proposals.
- Layer map: docs/architecture.md:34, coded at api/src/test/architecture/import-boundaries.test.ts:24-41. L0 auth, health, notification-store; L1 admin, client, identity, jobs, payouts, connects; L2 freelancer; L3 agency; L4 messaging; L5 meetings, notifications, proposals; L6 contracts.
- Architecture tests (api/src/test/architecture, 13 files plus 4 in `routing/`):
  - import-boundaries.test.ts: module boundary :173, self-import :181, layer :188, infrastructure direction :196, middleware :204, controller-database :216, stale exceptions :229, cycles :245.
  - table-access.test.ts:60-111 (read-only allowlist, no cross-module writes, no stale entries); table-files.test.ts:38; table-ownership.test.ts:7; schema-consumers.test.ts:12.
  - notification-store.test.ts:40-86 (layer 0, sole writer of `notifications`).
  - repository-sql.test.ts:40 (SQL only in repositories); repository-purity.test.ts:22 (no ApiError, throw or non-SQL I/O in repositories).
  - module-layout.test.ts:47; infrastructure-layout.test.ts:62; shared-layout.test.ts:51; controller-input.test.ts:27; import-aliases.test.ts:18.
  - routing/: route-contract-check, route-validation-check, uuid-params.validation, validation-order.
- Exceptions: api/src/test/architecture/boundary-exceptions.ts:7 is `[]`. table-access-allowlist.ts holds 59 read-only entries (type allows only `access: "read"`, :1-7).
- Folder layout rule: api/AGENTS.md "Module folder layout" (ADR 0016), enforced by module-layout.test.ts:47.
- Process shape: one Node process, one HTTP server. api/src/server.ts:1-8 calls `start()`; bootstrap/start.ts:39,51 listens once. API prefix `/api/v1` (api/src/config/constants.ts:1; app.ts:29,41).

Unknown: none for this section beyond line-level detail of the 59 allowlist entries (count is exact, entries were not listed).

## 2. Data access

- Driver: `drizzle-orm/node-postgres` over one `pg` Pool, `export const db = drizzle(pool)` with no schema argument (api/src/database/client.ts:1-2,12-20,31). One `DATABASE_URL` (api/src/config/env.ts:72,237). No replica, second connection or materialized view found (grep of `src` and `drizzle/`).
- Pool settings (api/src/database/database.constants.ts:1-5): max 10, connectionTimeout 10 s, idleTimeout 30 s, statement_timeout 60 s, idle_in_transaction_session_timeout 60 s. Pool error listener client.ts:22.
- Transactions: 30 non-test `.transaction(` call sites, e.g. modules/payouts/services/payouts.service.ts:129,418; modules/contracts/services/contracts.lifecycle.service.ts:123. Services open the transaction and pass the handle (`DbExecutor`, api/src/database/database.types.ts) to repositories (api/AGENTS.md "Layout"). No transaction helper wrapper (retry, savepoint) was found.
- Isolation levels: none set in non-test code (grep isolationLevel, SERIALIZABLE, REPEATABLE: no hits). Advisory locks: none.
- Row locks:
  - modules/contracts/repositories/contracts.state.repository.ts:25 `.for("update")`.
  - modules/payouts/repositories/payouts.repository.ts:60 (single-id `IN (SELECT ... FOR UPDATE SKIP LOCKED)`), :93 (`FOR UPDATE OF o SKIP LOCKED` inside the claim UPDATE).
  - modules/contracts/repositories/contracts.refund-reconciliation.repository.ts:85-88 `.for("update", { skipLocked: true })`.
- Claim pattern: `WITH picked AS MATERIALIZED ... UPDATE ... FROM picked` with `.limit(filter.limit)` at contracts.refund-reconciliation.repository.ts:87,90-96. The payout claim is a single-row claim by id (payouts.repository.ts:73-100).
- Guarded conditional UPDATEs (attempts or status guard): payouts.repository.ts:38-61 (guard builder), :199 `failProcessingPayoutIfAttemptsMatch`, :226 park, :238 `markProcessingPayoutPaidIfAttemptsMatch`; contracts.state.repository.ts (`markMilestoneFundedIfPending`, api/AGENTS.md "Layout").
- Optimistic version columns: none. No `version` or `row_version` column in any `*.model.ts` (grep) [v]. `updated_at` columns exist (19 matches for version|updatedAt across 10 models) but their use as a write guard was not examined.
- Retries on serialization failure or deadlock (SQLSTATE 40001, 40P01): none found in non-test code. Only `isUniqueViolation` (23505) handling exists (api/src/database/pg-errors.ts per api/AGENTS.md).
- Unbounded read: `findClaimableCandidates` has no LIMIT, ordered by `created_at` (payouts.repository.ts:171-197) [v]; the caller maps the full result (payouts.service.ts:155) and processes candidates sequentially (payouts.service.ts:483-485).
- Migrations: 11 files `api/drizzle/0000..0010`, 646 lines total. `CREATE INDEX`/`UNIQUE` statements: 35 (0000: 29, 0001: 1, 0003: 1, 0007: 3, 0010: 1). Drizzle `index()`/`uniqueIndex()` lines in the 16 model files: 35.
- Notable indexes: partial `payout_history_open_idx` (0001), `meetings_one_active_per_conversation_unique` (0003), `job_posts_published_feed_idx` (0007, WHERE status='PUBLISHED'), `contracts_refund_retry_idx` (0010; contracts.model.ts:80). Generated column `job_posts.content_norm` (drizzle/0008_job_posts_content_norm.sql:1; jobs.model.ts:32). No GIN, trigram, tsvector or full-text index found. Money columns moved to bigint in 0002_money_to_cents.sql.
- Loops with awaited per-item work (candidate N+1 sites; callee bodies not read, so whether each issues a query per item is unverified):
  - modules/payouts/services/payouts.service.ts:483-485; modules/contracts/services/contracts.refund-reconciliation.service.ts:313-314; contracts.orphan-payment-detection.service.ts:100.
  - modules/admin/services/admin.listings.service.ts:43-44 (`Promise.all`, one Clerk `getUser` per unique authId).
  - modules/agency/services/agency.profile.service.ts:345,383-384; modules/client/services/client.service.ts:207,355; modules/freelancer/services/freelancer.profile.service.ts:66-67.
- Feeds: two SQL queries per page by design (api/AGENTS.md "Job feeds", ADR 0022).

Unknown: whether the 0002-0009 snapshots in `drizzle/meta` hold index definitions beyond the counted statements; the batch size of payout candidate selection beyond the missing LIMIT; per-item query behavior of the loops above.

## 3. Redis

- Client: npm `redis` ^6.2.0 (api/package.json:43); no ioredis. One client, api/src/infrastructure/cache/redis.client.ts:6-17, reconnect strategy retries 0-9 with delay `min(100*2^n, 3000)` ms, then returns an Error (:9-15). No connect or command timeout set in code. Error listener logs `redis.error` (:19-28).
- Lifecycle: connect + ping awaited before listen (bootstrap/start.ts:46-51); startup failure logs fatal and exits 1 (start.ts:71-83); `quit` at shutdown (bootstrap/shutdown.ts:208). `REDIS_URL` is required by zod (config/env.ts:76).
- Uses and keys:
  - Rate limits: `rl:<name>:<key>` (middleware/constants/rate-limit.constants.ts:13; store prefix redis-rate-limit-store.utils.ts:69), Lua INCR + PEXPIRE on first hit (constants:17-24), 500 ms op timeout (constants:14).
  - Account-auth cache: `account:auth:<userId>:<role>` (infrastructure/utils/account-auth-cache-key.utils.ts:4); TTL 600 s, negative 30 s (modules/auth/constants/auth.constants.ts:3-4); read and SETEX in modules/auth/middleware/auth.middleware.ts:50,69-75 [v]; invalidation DEL in infrastructure/cache/account-auth.cache.ts:6-20.
  - Connects balance cache: `connects:<userId>:freelancer`, `connects:<agencyId>:agency` (modules/connects/utils/connects.cache-keys.ts:2,5); TTL 600 s sliding (connects.constants.ts:4; connects.middleware.ts:19-41); writers in connects.service.ts:36,87,99-110,313, proposals.submission.service.ts:94,199, proposals.review.service.ts:181-189.
  - Daily webhook dedupe: `webhook:daily:<event.id>`, SET NX EX 600, 2 s op timeout (modules/meetings/services/meetings.webhook.service.ts:15-16,101-118,177); DEL when the handler fails after claiming (:120-127,199-203).
  - Health PING (modules/health/services/health.service.ts:55-69); admin Redis explorer SCAN COUNT 100 and reads capped at 100 entries (modules/admin/services/admin.system.service.ts:83,105-125).
- Not on Redis: admin session (HMAC token, middleware/utils/admin-session.utils.ts:10-13); Socket.IO adapter (messaging.socket.ts:87, plain `new Server`); SSE client registry (in-memory Maps, modules/notifications/services/notifications.sse.ts:3-4); no pub/sub, queue or lock use found.
- Behavior when Redis is down:
  - Rate limiters: error or 500 ms timeout is caught, a warning is logged at most once per minute, requests fall back to a per-process `MemoryStore` (redis-rate-limit-store.utils.ts:14-31,81-112).
  - Account-auth read: `redis.get` and `redis.setEx` have no try/catch in `isAccountAvailable`, so a Redis error propagates out of the auth path (auth.middleware.ts:45-78) [v]. Verify-token errors are mapped to 401 (:104-105,140-141); whether this particular error is also mapped to 401 was not traced.
  - Connects middleware: no try/catch (connects.middleware.ts:19-41).
  - Daily webhook dedupe: fail-open, event processed anyway, log `webhook.inbound.dedupe_unavailable` (meetings.webhook.service.ts:91-118,180-183).
  - Cache invalidation: caught and warned (account-auth.cache.ts:9-19).
  - Readiness: `GET /api/v1/ready` answers 503 (health.service.ts:60-63; health.controller.ts:40).
  - Startup with Redis down: process exits 1 (start.ts:71-83).

Unknown: node-redis v6 defaults (offline queue, connect and command timeouts); whether the client recovers after the 10 reconnect attempts are exhausted (no app code path found); windows of the message-write and content-write limiters (user-rate-limit.middleware.ts:42-46).

## 4. RabbitMQ

- Libraries: `amqplib` ^2.3.1 and `amqp-connection-manager` ^5.0.1 (api/package.json:31-32). Heartbeat 10 s (infrastructure/events/rabbitmq.client.ts:18). Reconnect is delegated to the library. Optional: enabled only when `RABBITMQ_URL` matches the amqp(s) pattern (config/env.ts:86-92); health `rabbit ok = enabled && connected` (rabbitmq.client.ts:104-110).
- Channels: confirm channels with topology asserted on each (re)connect (rabbitmq.client.ts:57-67); publisher `notifications-publisher` (:92-96); consumer `notifications-consumer` (:98-102). Bounded close (:112-136).
- Topology (infrastructure/events/notification.topology.ts:10-45):
  - fanout DLX `notifications.dlx` (:23); durable DLQ `notifications.dead` bound with empty key (:26-27).
  - topic exchange `notifications` (:29); routing key `notifications.created` (infrastructure/constants/index.ts:6).
  - quorum queue `notifications.storage`, `x-delivery-limit` 5 (constants:8), DLX set, at-least-once dead-lettering, `reject-publish` overflow (topology:30-39); bound to the routing key (:40-44).
  - No message TTL, retry queue, wait queue or delayed exchange declared. One exchange pair, one work queue, one DLQ.
- Publisher (notification.publisher.ts): persistent (deliveryMode 2), `messageId` = envelope id, 2 s timeout (:27-35); two attempts with no delay (:38-50). `sendNotification` never throws: returns "disabled" without a URL (:66), logs `queue.publish.skipped` and returns "failed" when disconnected, nothing is queued locally (:68-81), logs `queue.publish.failed` on error (:83-100).
- Publish call sites (all through `sendNotification`, no outbox): modules/agency/services/agency.invitations.service.ts:321; agency.profile.service.ts:494; contracts/services/contracts.lifecycle.service.ts:559,569,727; contracts.milestones.service.ts:379; proposals/services/proposals.review.service.ts:208; proposals.submission.service.ts:100,205. Kinds still published this way: api/AGENTS.md "Rules" (CONTRACT_ACCEPTED, MILESTONE_ADDED, CONTRACT_COMPLETED, REVIEW_RECEIVED, PROPOSAL_RECEIVED, PROPOSAL_VIEWED, answered-invitation notice, AGENCY_WELCOME_BONUS).
- Only one event type exists: `notifications.created`. Consumer count: one (modules/notifications/notifications.consumer.ts:239-244, started only when RabbitMQ is configured, bootstrap/start.ts:54-56).
- Envelope (notification.envelope.ts:42-48,50-61): `{ id: uuid, type: "notifications.created", occurredAt, version: z.literal(2), payload }` [v]. Deviation: ADR 0004 says version 1; the repo wins.
- Consumer (notifications.consumer.ts): prefetch 10 (:17,92), manual ack (`noAck` false, :93). Invalid JSON or envelope: nack without requeue, so dead-lettered (:144-148). Insert via `insertNotificationIfNew` (:154; notifications.repository.ts:44-64) which relies on `onConflictDoNothing` on `event_id` (notification-store.repository.ts:23); a duplicate yields no row and no push. On failure: in-memory per-envelope counter, map capped at 1000 (:20,38,165-182); exhausted (>=5) or SQLSTATE class 22/23 gives nack without requeue (:22-23,173); otherwise nack with requeue, consumer pauses and resumes with 1 s to 30 s backoff after a DB ping (:98-131). Ack follows the insert (:192), SSE push after ack (:193-199). Messages arriving while stopped are requeued (:202-205). `stop` waits up to a timeout (:218-233).
- Consumer idempotency: unique `event_id` plus `onConflictDoNothing`. No separate inbox table.
- Without RabbitMQ: API starts and works with Postgres and Redis only (api/AGENTS.md "Rules"); publisher returns "disabled"; consumer not started.

Unknown: amqp-connection-manager timings and whether publish blocks or rejects while disconnected at boot; whether anything consumes or alerts on `notifications.dead` (no consumer for the DLQ found in the explorer pass); retention of the DLQ.

## 5. Reliable delivery

- Naming: ADR 0024 is titled "transactional notification writes" (docs/decisions/0024-transactional-notification-writes.md). There is no outbox table, relay or poller for notifications: grep for `outbox` in non-test `api/src` returns 0 hits. The `notifications` table (modules/notification-store/models/notification-store.model.ts:13-17) has a unique `event_id` (:17) and no status or attempts column [v].
- Mechanism: `insertNotification(executor, input)` inside the business transaction with `onConflictDoNothing` on `event_id` (notification-store.repository.ts:6-26); deterministic id `uuidV5("kind:entity:transition")` (notification-store/utils/notification-store.event-id.ts:14-25); after commit, `pushStoredNotification(row)` over SSE (notification-store/services/notification-store.push.service.ts:14-28), which swallows errors and is a debug-logged no-op without a registered pusher. Pusher registered at bootstrap/start.ts:53, cleared at shutdown.ts:203.
- Covered in-transaction (api/AGENTS.md "Rules"): CONTRACT_OFFER, MILESTONE_FUNDED, MILESTONE_SUBMITTED, MILESTONE_APPROVED, MILESTONE_CHANGES_REQUESTED, CONTRACT_DECLINED, CONTRACT_WITHDRAWN, PAYOUT_COMPLETED, PROPOSAL_INTERVIEWED, AGENCY_INVITATION. Code evidence: contracts.lifecycle.service.ts:641-660 (`recordRefundWithNotice`, insert :655; used at :356 and contracts.refund-reconciliation.service.ts:112); payouts.service.ts:425. Event ids per flow: ADR 0024 :97-103 (not re-verified in code, except the helper above).
- Sweeper: `processDuePayouts` first calls `sweepUnnotified` (payouts.service.ts:466-476, :124-145): PAID rows with `notified_at` NULL, LIMIT 300 (payouts.repository.ts:15,136-147), insert + mark in one transaction, push after; failures logged `payment.payout.notification_failed` (:138-143). No attempt counter. Re-run happens on the next hourly cron (payouts.cron.ts:6; inference).
- Retry state outside notifications: refund reconciliation columns `refund_attempts`, `refund_next_attempt_at`, `refund_last_error`, backoff `min(15 min * 2^n, 24 h)`, park at 20, 10 min lease (docs/decisions/0023-refund-reconciliation.md:11-16; claim CTE contracts.refund-reconciliation.repository.ts:90-92). Payout retry backoff: modules/payouts/utils/payouts.failure.ts:61; stuck claim after 15 min (payouts.state.ts:10).
- NOT covered by the notification-store:
  - the 8 `sendNotification` sites above: lost on broker outage or disconnect (ADR 0024:12-13);
  - SSE push: best effort, no replay (ADR 0024:64); conversation emits after commit (:65);
  - Stripe refunds and transfers run outside the DB transaction (docs/decisions/0023:7; payouts.service.ts `processCandidate`); idempotency keys exist for refunds and payout transfers (section 6);
  - Socket.IO messaging events (in-process, no Redis adapter).
- Email: no email sender found (grep nodemailer|sendEmail|sendMail|postmark|sendgrid: 0 hits).

Unknown: retention or cleanup of the `notifications` table (no delete function found; migrations not checked); whether payout event id and all in-transaction event ids match ADR 0024 (cited from the ADR).

## 6. External integrations

Dependencies (api/package.json:27-47): @clerk/backend, @imagekit/nodejs, stripe ^23.1.0, redis, amqplib, amqp-connection-manager, socket.io, pg, drizzle-orm, @react-pdf/renderer. Daily has no SDK (raw `fetch`).

- Stripe: lazy client, only `timeout` set to 30 000 ms (infrastructure/payments/stripe.client.ts:6-14; constants/index.ts:4). No `maxNetworkRetries` in `api/src` (grep, no hits) [v]; SDK default is 2 (stripe@23.1.0 `cjs/platform/PlatformFunctions.js:52-53`; the extensibility platform variant returns 0, `ExtensibilityPlatformFunctions.js:26-28`; which variant the Node entry uses was not traced). No `apiVersion` pinned in the repo.
  - Idempotency keys sent: refunds `refund:<pi>:<reason>[suffix]` (contracts.checkout.service.ts:151-155); payout transfers, key persisted per row (payouts.service.ts:317-318,335; payouts.repository.ts:206-222). Creates for checkout sessions, customers, identity sessions and v2 accounts send no key (connects.service.ts:171,255; contracts.checkout.service.ts:332,340,401; identity.service.ts:31); the SDK generates a per-request key for POSTs (`cjs/RequestSender.js:300`), not stored.
  - Webhooks: raw body before json (app.ts:23-30; paths config/constants.ts:4-9); signature via `constructEvent`, tolerance 300 s (infrastructure/payments/stripe.webhook.ts:23-38). No Stripe event-id store: `event.id` is only logged (contracts.checkout.service.ts:95,108,127). Connects handles only `checkout.session.completed` (connects.webhook.service.ts:22). Transient failures throw so Stripe retries; permanent refund errors are logged and answered 200 (api/AGENTS.md "Job and payment flow").
  - Error mapping: refund failure 502 (contracts.checkout.service.ts:260), missing keys 503 (:291,377), checkout start 502 (:366,428); other SDK errors are not mapped and reach the error handler as 500.
- Clerk: lazy client, `secretKey` only, no timeout or retry config (infrastructure/auth/clerk.client.ts:8-14). Token verification with `authorizedParties` (auth.middleware.ts:95-98,131-134); any thrown error becomes 401 (:104-105,140-141). Custom retry: signup `getUser` at 300 ms and 600 ms (modules/auth/services/auth.service.ts:24-34). Display sync 2 s timeout with placeholder fallback (auth.display.service.ts:48-57; auth.constants.ts:1). Admin listings do one Clerk `getUser` per unique id (admin.listings.service.ts:43-44).
- Daily (infrastructure/video/daily.client.ts:13-41): `fetch` with no timeout, no retry, no idempotency key; non-ok response throws a plain Error (:37), reaching the handler as 500. Room creation meetings.service.ts:74, no catch seen. Join-URL token failure falls back to the stored room URL (messaging.meeting-join.service.ts:38-52). Webhook: HMAC-SHA256 over `timestamp.rawBody`, 5 min freshness (meetings.webhook.service.ts:13,25,28-71), Redis dedupe (section 3).
- ImageKit: lazy client, `privateKey` only, no timeout or retry in code (infrastructure/storage/image-kit.client.ts:5-11). Uses: freelancer.profile.service.ts:175-183 (502 when no `fileId`), agency.profile.service.ts:364, shared/uploads/upload-documents.ts:40-44, deletes jobs.service.ts:58,133.
- Redis and RabbitMQ settings: sections 3 and 4.
- Circuit breaker, bulkhead: none (grep opossum, cockatiel, p-limit, p-queue, bottleneck, semaphore: no hits). Per-call timeouts found: Stripe 30 s, publish 2 s, Redis limiter 500 ms, Daily dedupe 2 s, Clerk display 2 s, readiness 2 s per check (health.service.ts:16).

Unknown: Clerk `verifyToken` network and JWKS behavior; ImageKit SDK timeout and retry defaults; Clerk behavior when unreachable.

## 7. Background jobs

- Scheduler: `node-cron` ^4.6.0 (api/package.json:38); the only `cron.schedule` calls are modules/payouts/payouts.cron.ts:38 and modules/contracts/contracts.cron.ts:79,161. The only `setInterval` is the SSE heartbeat, 25 s (notifications.controller.ts:108-110).
- Jobs:
  - Payout run: `0 * * * *` (payouts.cron.ts:6), `noOverlap: true` (:38-41), always scheduled (start.ts:58), no env switch. Claim via `FOR UPDATE SKIP LOCKED` (payouts.repository.ts:58-60,73-93); stuck claim reclaimed after 15 min (payouts.state.ts:10).
  - Refund reconciliation: `*/15 * * * *` (contracts.cron.ts:8), mode `REFUND_RECONCILIATION_MODE` off|detect|on, default detect (config/env.ts:93-100); `off` is not scheduled (contracts.cron.ts:63-73); in-process `inFlightRun` skip (:42-61); cross-process safety is a DB lease (ADR 0023:16); no run at boot (ADR 0023:17).
  - Orphan payment detection: `17 * * * *` (contracts.cron.ts:105), mode `ORPHAN_PAYMENT_DETECTION_MODE` off|detect, default detect (env.ts:101-105), in-process overlap guard (:124-143), read-only.
- Distributed lock or leader election: none; every process schedules every cron (start.ts:58-60). Process modes (API-only, worker-only): none; the switches are `RABBITMQ_URL`, the two mode vars.
- Startup order (bootstrap/start.ts:45-69): DB ping, Redis connect, create server, listen, register notification pusher, consumer if RabbitMQ, Socket.IO init, payout cron, refund cron, orphan cron. Listen error is fatal (:31-37).
- Shutdown order (bootstrap/shutdown.ts:146-213): stop accepting (:188), close SSE (:189), stop crons (:190-194), await in-flight payout, reconciliation and detection runs together with a 4 s bound (:195-201; :30-31), close HTTP and sockets (:202; :112-130), clear pusher (:203), stop consumer 3 s (:204-206), close RabbitMQ (:207), quit Redis (:208), end pool (:209). Force-exit timer 10 s (:28,158-165). Exit code 1 when a step failed (:212).
- Signals and crashes: SIGINT and SIGTERM (api/src/server.ts:6-7); `unhandledRejection` and `uncaughtException` run `handleFatalError`, which runs shutdown (bootstrap/crash-handlers.ts:13-50).
- Script (not run): `api/scripts/backfill-search-text.ts` (api/AGENTS.md "Rules").

Unknown: behavior of a cron tick when the process is shutting down beyond the 4 s drain bound.

## 8. Observability

- Logger: pino, JSON, no transport or pretty mode (api/src/config/logger.ts:32-49); level `info`, silent in test (:34); `LOG_LEVEL` is not read (grep). Redaction paths: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` (:38-44). The pino-http request serializer keeps only id, method, url without query (middleware/http-logger/http-logger.middleware.ts:25-30). Message sanitizer for Stripe keys, `whsec`, Bearer, JWT, long hex, URL credentials, 2000-char cap (shared/logging/sanitize-log.ts:4-31).
- Request id: inbound `x-request-id` accepted if `/^[A-Za-z0-9._-]{1,64}$/`, else `randomUUID`, echoed on the response (middleware/request-id/request-id.middleware.ts:4-18); used in error bodies (middleware/error/error.middleware.ts:57,85,102), the readiness 503 body (health.controller.ts:64) and pino-http `genReqId` (http-logger.middleware.ts:20).
- Not propagated: no request id on outbound calls to Stripe, Daily or ImageKit, none in the RabbitMQ envelope (no field in notification.envelope.ts), no `traceparent` or correlation id handling.
- HTTP logging skips `GET /health` and `/ready` (http-logger.middleware.ts:7,21-24).
- Health: `GET /api/v1/health` static 200 (health.controller.ts:11-27; routes/index.ts:49); `GET /api/v1/ready` pings Postgres and Redis, RabbitMQ not checked (health.service.ts:55-69; health.controller.ts:40); admin `GET /admin/system/health` uses a DB ping (admin.route.ts:90; admin.system.service.ts:11).
- Metrics, tracing, error tracking: none (no prom-client, OpenTelemetry or Sentry in `api/src` or api/package.json).
- Error handler (middleware/error/error.middleware.ts:45-105): 5xx answers "Internal server error." and logs `system.request.failed` with the stack capped at 2000 chars (:11,59-88).
- Alerting names documented but no alerting config in repo: `queue.publish.skipped`, `queue.publish.failed`, `payment.refund.unrecoverable`, `payment.refund.no_payment_intent`, `payment.orphan.detected` (api/AGENTS.md).
- Admin log stream `GET /admin/logs/stream` is a stub answering 503 "Logging is not configured." (admin.controller.ts:154-156).

Unknown: whether the pino-http child logger attaches `req.id` to every handler log line; any external log shipping (no config in repo).

## 9. Security and rate limiting

- Limiter implementation: `express-rate-limit` with a custom Redis store (middleware/utils/redis-rate-limit-store.utils.ts:62-124); a Lua script increments and sets `PEXPIRE` only on the first hit, which is a fixed window per key (rate-limit.constants.ts:17-24; algorithm named by reading the script's behavior as reported, not by a label in code). Headers: `standardHeaders: true`, `legacyHeaders: false`; 429 body `{ success:false, code, requestId }` (middleware/utils/rate-limit.utils.ts:7-20). Exempt: `/health`, `/ready`, webhook POSTs (:22-32). Most limiters are disabled in test env (rate-limit.middleware.ts:15,22-23,29-56).
- Limiters (key = IP unless stated): global 300 per 15 min on `/api/v1` (rate-limit.middleware.ts:17-24); admin login 20 per 15 min, successful requests skipped (:26-33; admin.route.ts:36-41); admin 150 per 15 min (:35-41); public search 60 per 60 s (:43-49; agency.route.ts:94; freelancer.route.ts:57); sign-up 10 per hour (:51-57; auth.route.ts:15). User-keyed (auth userId, else claims userId, else IP; user-rate-limit.middleware.ts:19-46): messages 120, content 30, agency invites 20 per hour (constants :7-11); routes: messaging.route.ts:28,45; jobs.route.ts:46-52,96; freelancer.route.ts:47,72; agency.route.ts:90,130,199,206,225.
- Headers and CORS: Helmet with cross-origin resource policy, `x-powered-by` off (app.ts:18-21). CORS origins from five env vars, localhost fallback only outside production, requests without Origin allowed, REST `credentials: false`, Socket.IO `credentials: true` (config/cors.ts:8-46; app.ts:28; messaging.socket.ts:87). `TRUST_PROXY` default false, accepts hop count or subnet list, `"true"` rejected (config/env.ts:44-69; app.ts:20).
- Body limits: JSON 100 kb default, 20 mb on five routes (middleware/constants/json-body.constants.ts:4-21): POST /jobs, PUT /jobs/:id, POST messages, PUT freelancer profile, PUT agency. Webhooks use `express.raw` without a `limit` option (app.ts:23-25). Socket.IO sets no `maxHttpBufferSize` (messaging.socket.ts:87).
- Validation: zod `validate({ params, query, body, responses })` on every route, enforced by route-validation-check; exemptions (raw webhooks, health, ready) in test/architecture/routing/validation-allowlist.ts:7-22,92-97.
- Authentication: HTTP Bearer token via Clerk (auth.middleware.ts:36-43,95-98), role from body or query (:164), account state cached (section 3). Socket.IO handshake `{ token, role }` through `authenticateAccount`, 403 without an account (messaging.socket.ts:75-95). SSE `/notifications/stream` behind `isAuthenticated` (notifications.route.ts:20,45-49). Admin: password compared as SHA-256 digests with `timingSafeEqual` (admin.auth.service.ts:7-21); session token `expiresAt.HMAC-SHA256`, TTL 2 h (admin-session.utils.ts:4-35; admin-session.constants.ts:1); query-string token accepted only on `/admin/logs/stream` (admin-session.middleware.ts:16-20).
- Authorization: agency membership and permission (`requireAgencyId`, `requireAgencyIdWithPermission`, agency.membership.service.ts:31,63; agency.permissions.ts). Public ids instead of Clerk ids (api/AGENTS.md; `openapi-clerk-ids.test.ts`).
- Uploads: no multer or busboy. Attachments are base64 data URLs in JSON: 5 files, 5 MB each, 14 MB total, type allowlist, magic-byte and executable-signature checks, DOCX limits of 1000 entries and 100 MB uncompressed (shared/uploads/constants/attachments.constants.ts:1-19; utils/attachment-file-type.utils.ts:6,37-44; attachment-docx.utils.ts:8-9).
- SSRF: the only outbound `fetch` goes to a fixed Daily base URL (daily.client.ts:21,103-105); portfolio live URLs are validated http(s) and stored, not fetched (shared/uploads/portfolio-images.ts:6-22).

Unknown: whether user-keyed limiters run after authentication on every route (order not checked per route); per-route ownership checks (not surveyed); `express.raw` default limit and Socket.IO `maxHttpBufferSize` default (library defaults not verified).

## 10. API surface

- OpenAPI: custom generator, not a library. api/src/openapi/document.ts:27-47 introspects the Express router and converts zod via openapi/conversion/convert-schema.ts; `openapi:generate` = `tsx src/openapi/generate.ts` (api/package.json:11) writes `docs/api/openapi.json` (generate.ts:35-42). Version 3.1.0 (docs/api/openapi.json:6500). No runtime endpoint serves it; Swagger UI runs from `infra/docker` (docs/architecture.md:11-12).
- Size: 102 operationIds; GET 58, POST 25, PATCH 11, PUT 4, DELETE 4; 88 path keys (grep, not a JSON parse). Registrations per module (grep of `*.route.ts`, sums to 102): admin 12, agency 23, auth 2, client 7, connects 4, contracts 12, freelancer 10, health 2, identity 2, jobs 9, meetings 2, messaging 5, notifications 4, proposals 8. Mounts: routes/index.ts:34-50.
- Versioning: single prefix `/api/v1`; no other scheme.
- Pagination: offset `{ results, hasMore }` default 20, max 100, offset max 10000 (shared/validation/constants/pagination.constants.ts:3-8; schemas/pagination.schema.ts:18-31), `hasMore` via limit+1 (utils/pagination.utils.ts:1-7), about 26 `offsetPage(` response declarations. Cursor `{ results, nextCursor }` only on the messages list (messaging.route.ts:43; responses/messaging.responses.ts:123): cursor is base64url JSON `[createdAtISO, id]` (messaging.messages.service.ts:37-45,113), default 30, max 50 (shared/validation/constants/messaging.constants.ts:7). Exemption: admin Redis keys (SCAN capped at 200).
- Idempotency: no `Idempotency-Key` header support and no request deduplication on POST (grep). Stripe-side keys only (section 6).
- Streams: SSE `GET /notifications/stream` (notifications.route.ts:46-48; controller :92-129, heartbeat 25 s); admin log stream is a 503 stub; both excluded from OpenAPI (openapi/introspection/contract-allowlist.ts:38-47). Socket.IO server `new Server(server, { cors })` (messaging.socket.ts:86-95), initialised at start.ts:57.
- Client generation: `packages/api-client/scripts/generate.mjs` (openapi-typescript, :5) writes `src/generated/schema.ts` and `meta.ts`; runtime `openapi-fetch` (packages/api-client/package.json:18). `packages/web-core` (react-query, socket.io-client; package.json:17-23) provides the SSE client (`sse.ts:208`) and socket (`messaging-socket.ts:4`).
- Consumers (grep counts; "fetch" includes route handlers and proxies):
  - landing-page: no api-client or web-core import; 6 files call `fetch` to `${NEXT_PUBLIC_SERVER_URI}` (e.g. app/talents/talents-directory.tsx:450, app/api/sign-up/route.ts:53); no socket or SSE.
  - client-dashboard: 22 files import api-client, 30 import web-core, 0 `fetch(`; migration complete (docs/frontend-migration-plan.md:66-81).
  - freelancer-dashboard: 0 api-client, 0 web-core; 52 `fetch(` calls in 21 files (e.g. app/freelancer-dashboard.tsx:110, proxy.ts:40, hooks/use-notifications.tsx:72); socket.io-client in hooks/use-unread-messages.ts:6 and messages-dashboard.tsx:16.
  - agency-dashboard: 0 api-client, 0 web-core; 53 `fetch(` calls in 19 files (e.g. app/api/me/route.ts:26); socket.io-client in hooks/use-unread-messages.ts:6 and messages-dashboard.tsx:13.
  - admin-dashboard: 17 files import api-client, 0 web-core, 2 `fetch(`; log stream proxied through api-client `parseAs: "stream"` (lib/handlers.ts:140-165), browser EventSource on its own `/api/logs/stream` (app/(dashboard)/logs/logs-stream.tsx:48).
- Migration status (docs/frontend-migration-plan.md:66-81): batches 0, 1a, 1b, 2 (admin), 3a-3g (client) done; "Next: batch 4 (freelancer app)". Unmigrated list: packages/eslint-config/next.mjs:7. The landing page has no entry in the Status section.

Unknown: exact count of offset-paginated operations (grep only); HTTP verb of messaging.route.ts:43 (inferred GET); `MESSAGING_LIMITS.cursor` max length (not located).

## 11. Performance indicators shown by the repo

- Single process: no `cluster`, `worker_threads` or `child_process` in `api/src` (grep, tests excluded). Node `>=26` (api/package.json:5-6; `.node-version`); start `node --env-file-if-exists=../../.env dist/server.js` (api/package.json:14).
- Deployment files: none (no Dockerfile, Procfile or platform config found); only `infra/docker/docker-compose.yml` for local Postgres 18, Redis 8, RabbitMQ 4.4, Swagger UI.
- CPU-bound: PDF generation with `@react-pdf/renderer` `renderToBuffer` (modules/freelancer/utils/earnings-certificate.pdf.tsx:1,286). Hashing only: sha256 (admin.auth.service.ts:7), sha1 for UUIDv5 (shared/ids/uuid-v5.ts:12). No bcrypt, argon or sharp.
- Files and images: uploads arrive as base64 data URLs in JSON (5 MB per file, 14 MB total; section 9), are decoded to `Buffer` for type sniffing (shared/uploads/attachments.ts:140) and forwarded to ImageKit as bytes via `imageKit.files.upload` (shared/uploads/upload-documents.ts:40-44); no ImageKit signature endpoint found. DOCX inspection up to 100 MB uncompressed (attachment-docx.utils.ts:9).
- Body sizes: 100 kb default, 20 mb on five routes (section 9).
- Streams: SSE with in-memory client registries (notifications.sse.ts:3-4); Socket.IO without adapter, so connections and presence live in one process (messaging.socket.ts:87).
- Compression, ETag, cache headers: no compression middleware and no cache or ETag configuration found in `api/src`; SSE sets `Cache-Control: no-cache` (notifications.controller.ts:100).
- Bounded or unbounded reads: pagination max 100 and offset max 10000; payout sweep LIMIT 300; payout candidate selection has no LIMIT (section 2); admin Redis keys capped at 200.
- DB pool of 10 clients shared by HTTP handlers, cron jobs and the consumer (database.constants.ts:1-5).
- No benchmarks, load tests or profiling output in the repo were found; no performance claim is made here.

Unknown: production hosting, process count and any reverse-proxy compression or caching (no deploy config in repo); whether every upload path passes data URLs (verified for the attachments parse path, attachments.ts:40-60).

## 12. Tests and CI

- 200 `*.test.ts` files under `api/src`; 1625 lines starting with `it(` or `test(` (`it.each` and `it.todo` not counted).
- Per module (files / cases): admin 8/65; agency 11/79; auth 10/74; client 3/48; connects 5/29; contracts 15/303; freelancer 9/107; health 3/11; identity 3/12; jobs 8/64; meetings 6/50; messaging 14/92; notification-store 3/19; notifications 4/34; payouts 5/70; proposals 7/48.
- Other areas (files / cases): src/test 21/141 (17 architecture files); infrastructure 10/53; middleware 13/89; shared 21/116; config 3/43; database 1/5; bootstrap 5/26; openapi 11/38.
- By suffix: `*.integration.test.ts` 43, `*.contract.test.ts` 14, `*.cron.test.ts` 2, consumer 1, repository 1, parity 1; the remaining 141 are plain `*.test.ts`.
- Vitest (api/vitest.config.ts): project `parallel` (:40-43, groupOrder 0) excludes the `payoutTotalsFiles` list (:4, 11 files); project `payout-totals` (:49-52, `fileParallelism: false`, groupOrder 1); setup `src/test/setup/setup.ts`.
- Test database: `db:test:create|migrate|setup` (api/package.json:23-25; infra/scripts/test-db.mjs); guard `src/test/setup/assert-test-database.ts`; CI uses `TEST_DATABASE_URL`.
- Test doubles (files with `vi.mock`): redis.client 55, rabbitmq.client 11, stripe.client about 25, Clerk about 46, daily.client 3, imagekit 1; supertest in 65 files. One real-broker test: infrastructure/events/rabbitmq.client.integration.test.ts. Lock behavior helper: src/test/support/lock-holder.ts:58-66.
- CI (.github/workflows/ci.yml): `check` :17-37 (`pnpm check`); `build` :39-68; `api-test` :70-165 (Postgres 18 and RabbitMQ 4.4.0 service containers, Redis 8 via `docker run` :123-132, `db:test:migrate` :133, vitest with coverage and junit :135-145, `openapi:generate` then `git diff --exit-code docs/api/openapi.json` :146-150, RabbitMQ integration junit check :152-154); `gitleaks` :167; `audit` :192 (informational); `dependency-review` :223; `codeql` :239; `workflow-lint` :260; `compose-validate` :285; `ci-pass` :321 (required gate).

Unknown: test counts for `it.each` expansions; coverage thresholds (not read); frontend test counts (out of scope).

## 13. Candidate checklist

| Candidate                                  | Status  | Evidence                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify or a second HTTP framework         | ABSENT  | Express only; no other HTTP framework in api/package.json:27-47 (socket.io is a WebSocket server, messaging.socket.ts:86)                                                                                                                                                                                 |
| BFF                                        | PARTIAL | No BFF service; Next.js route handlers and proxies exist per app: agency app/api/me/route.ts:26, freelancer proxy.ts:40, admin lib/handlers.ts:140-165, landing app/api/sign-up/route.ts:53                                                                                                               |
| CQRS or read models                        | ABSENT  | Single DB, no read tables or views; feeds are SQL queries in the owning module (ADR 0022)                                                                                                                                                                                                                 |
| Circuit breaker                            | ABSENT  | grep opossum, cockatiel and similar: no hits (section 6)                                                                                                                                                                                                                                                  |
| Retry policy                               | PARTIAL | No shared policy. Ad hoc: Stripe SDK default 2, publisher 2 attempts without delay (notification.publisher.ts:38-50), Clerk getUser 300/600 ms (auth.service.ts:24-34), consumer backoff 1-30 s (notifications.consumer.ts:98-131), DB-backed payout and refund backoff (payouts.failure.ts:61; ADR 0023) |
| Bulkhead                                   | ABSENT  | No p-limit, p-queue or semaphore; one shared pg pool of 10 (database.constants.ts:1-5); per-call timeouts only                                                                                                                                                                                            |
| Rate limiting                              | EXISTS  | express-rate-limit, Redis store with Lua fixed window and memory fallback; section 9                                                                                                                                                                                                                      |
| Cache-aside                                | EXISTS  | Account-auth (auth.middleware.ts:45-78) and connects balance (connects.middleware.ts:19-41)                                                                                                                                                                                                               |
| Outbox                                     | PARTIAL | Transactional write of the notification row inside the business transaction (ADR 0024; contracts.lifecycle.service.ts:655; payouts.service.ts:425) with a payout sweeper (payouts.service.ts:124-145). No outbox table or relay (0 `outbox` hits); 8 call sites still publish directly (section 4)        |
| Inbox and idempotent consumer              | PARTIAL | Idempotent by unique `event_id` + `onConflictDoNothing` (notification-store.repository.ts:23); no inbox table; Daily webhook Redis dedupe (meetings.webhook.service.ts:101-118); no Stripe event-id dedupe                                                                                                |
| Unit of work                               | PARTIAL | `db.transaction` with the executor passed to repositories (api/AGENTS.md "Layout"); no UoW abstraction                                                                                                                                                                                                    |
| Saga or process manager                    | PARTIAL | State machines with DB-backed retry columns for refunds (ADR 0023) and payouts (payouts.repository.ts:38-93); no generic saga or orchestrator                                                                                                                                                             |
| Materialized views                         | ABSENT  | grep MATERIALIZED VIEW in `src` and `drizzle/`: no hits (the `AS MATERIALIZED` CTE is a query pattern, not a view)                                                                                                                                                                                        |
| Read replicas                              | ABSENT  | Single `DATABASE_URL` (env.ts:72)                                                                                                                                                                                                                                                                         |
| Optimistic locking                         | PARTIAL | No version columns [v]; guarded conditional UPDATEs act as compare-and-set on status or attempts (payouts.repository.ts:38-61,199-238)                                                                                                                                                                    |
| Pessimistic locking                        | EXISTS  | `FOR UPDATE` and `SKIP LOCKED` (contracts.state.repository.ts:25; payouts.repository.ts:60,93; refund-reconciliation.repository.ts:85-88)                                                                                                                                                                 |
| Retry queues and delayed messages          | ABSENT  | No TTL, wait queue or delayed exchange declared (notification.topology.ts:10-45); retry is in-process pause/requeue                                                                                                                                                                                       |
| Dead-letter handling                       | PARTIAL | DLX `notifications.dlx` and DLQ `notifications.dead`, delivery limit 5 (topology:23-39); no DLQ consumer or replay found                                                                                                                                                                                  |
| Message schema versioning                  | PARTIAL | `version` field, zod literal 2 (notification.envelope.ts:46,57) [v]; accepts only one version; ADR 0004 still says 1                                                                                                                                                                                      |
| OpenTelemetry                              | ABSENT  | No dependency or import                                                                                                                                                                                                                                                                                   |
| Tracing                                    | ABSENT  | No tracing library; request id only (section 8)                                                                                                                                                                                                                                                           |
| Metrics                                    | ABSENT  | No prom-client or equivalent                                                                                                                                                                                                                                                                              |
| Worker threads                             | ABSENT  | No `worker_threads` in `api/src`                                                                                                                                                                                                                                                                          |
| Job queues                                 | ABSENT  | Only node-cron (section 7); RabbitMQ carries one event type (notification storage) and is not used as a job queue                                                                                                                                                                                         |
| API gateway                                | ABSENT  | None in repo; production edge unknown (no deploy config)                                                                                                                                                                                                                                                  |
| Idempotency keys and request deduplication | PARTIAL | Stripe keys on refunds and payout transfers (section 6); no HTTP `Idempotency-Key`, no request dedupe on POST                                                                                                                                                                                             |

Also checked: error tracking ABSENT (no Sentry); distributed lock or leader election ABSENT (section 7); email delivery ABSENT (section 5); WebSocket scale-out adapter ABSENT (section 3).

## 14. Unrelated findings (not part of the inventory)

1. ADR 0004 documents envelope version 1; code uses version 2 (notification.envelope.ts:46,57) [v]. The root rule says the repo wins; the ADR was not updated.
2. The admin logs stream is a stub: `GET /admin/logs/stream` always answers 503 (admin.controller.ts:154-156), yet admin-dashboard ships a logs page and proxy that consume it (lib/handlers.ts:140-165; logs-stream.tsx:48).
3. api/AGENTS.md says the RabbitMQ connection is created by `src/bootstrap/start.ts`, while the explorer reports ADR 0004 naming `server.ts`; the code path is start.ts (consumer start at :54-56). Documentation drift only.
4. The Daily client has no timeout (daily.client.ts:13-41), so a hung Daily call has no application-level bound (Node's own socket defaults were not checked); room creation at meetings.service.ts:74 shows no catch. Reported as a risk, not exercised.
5. `findClaimableCandidates` is unbounded and processed sequentially inside a cron tick (payouts.repository.ts:171-197; payouts.service.ts:155,483-485); behavior with a large backlog was not examined.
6. Webhook `express.raw` is registered without a size option (app.ts:23-25); the effective limit is the library default, not verified.
7. The consumer's per-envelope failure counter is in memory (notifications.consumer.ts:20,38), so it resets on restart; the broker-side `x-delivery-limit` 5 is the durable bound.
8. `api/scripts/*.ts` exists (e.g. backfill-search-text.ts); per the repo rules it was neither read nor run.

No bugs outside the inventory scope were confirmed by running code; items 4 to 6 are code-reading observations.
