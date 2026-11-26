# 0025: Redis cache fail-open and reconnect

Status: accepted (2026-11-27, roadmap item 31)

## Context

Redis holds caches (account auth, Connects balances), rate-limit counters and webhook dedupe keys. It is never the source of truth: every cached value is also in Postgres. Before this change, two classes of call site turned a Redis problem into a user-facing failure:

- Reads on the request path failed closed. A rejected `get` in the auth middleware became a 500 from `isAuthenticated`, `identifyAccount` and `resolveAccountRole`, and a 401 from `authenticateAccount` (sign-up, socket handshake). The Connects middleware, mounted on every Connects route, answered 500. The admin Redis explorer answered 500.
- Cache writes after a commit threw after the business effect. A proposal submit answered 500 although the proposal was saved and the Connects were debited, and the client's retry then got 409. The same applied to interviews, Connects purchases and agency onboarding.

The client also stopped reconnecting for good after 10 attempts (about 15 s), so a short Redis outage left the API without Redis until a restart. Commands issued while it reconnected waited in the offline queue instead of failing.

The rate-limit store, the auth-cache invalidation and the Daily webhook dedupe were already fail-open and are unchanged.

## Decision

### Reconnect (option B)

- `redisReconnectStrategy(retries)` retries forever: `min(100 ms * 2^retries, 5 s) + 0 to 99 ms of jitter`. It never returns an `Error`.
- `disableOfflineQueue: true` and `socket.connectTimeout: 5 s`. A command on a client that is not ready rejects at once (`ClientOfflineError`) instead of waiting for the reconnect. The option names are those of the installed `@redis/client` 6.3.1 typings.
- Because the strategy no longer gives up, `connect()` would wait forever at boot. `connectRedis` wraps `connect()` and `ping()` in a 15 s deadline, so a missing Redis at startup still logs `system.startup.failed` and exits 1.
- `disconnectRedis` calls `quit()` only on a ready client, bounded by a 2 s deadline after which it calls `destroy()` and rejects, and calls `destroy()` on an open client that is not ready. Shutdown and the startup-failure path therefore never wait on a reconnect loop or a hung connection.
- The client logs `cache.redis.recovered` (info) on `ready` when a degradation (a client error or a failed cache command) was recorded since the last `ready`.

### Fail-open cache helper

`infrastructure/cache/fail-open.cache.ts` exports `cacheGet`, `cacheSetEx` and `cacheExpire`. Each skips Redis when `redis.isReady === false` (strict, so test mocks without the property still run the command), races the command against a 300 ms timeout, and on an error or a timeout returns `null` or nothing. It never throws. Failures log `cache.redis.degraded` (warn, `cache.op` and `error.name`, never the key or value) at most once per 60 s per process.

### Call sites

- Auth `isAccountAvailable`: a failed read or an unparsable cached entry is a cache miss, so the account is read from Postgres; the write is best effort. Authorization is unchanged, because a miss already went to the database.
- Connects middleware and `getAgencyConnectsBalance`: a failed read falls back to the database balance; `expire` and the write are best effort.
- Connects balance writes after a commit (onboarding bonus, purchases) go through `cacheFreelancerConnects` and `cacheAgencyConnects`, exported from `connects/index.ts`. Proposals submit and interview use the same exports instead of raw `redis.setEx`.
- Admin Redis explorer (`GET /admin/system/redis/keys`, `GET /admin/system/redis/keys/:key`): a Redis failure answers 503 `SERVICE_UNAVAILABLE`. Like every 5xx, the body carries the generic message; "Redis is unavailable." is only in the error and the log. The admin health `ping` is unchanged.

### Readiness

Unchanged (decision D1): `GET /ready` still answers 503 while Redis is not ready, and liveness does not touch Redis. The API now serves requests without Redis, but an orchestrator that uses readiness will still take the instance out of rotation. Revisit when hosting is known; reporting `redis: "degraded"` with 200 would change the `CheckStatus` enum and the OpenAPI document.

## Options considered (reconnect)

- A. Library default (retry forever). Least code, but `connect()` at boot then never rejects, so the process hangs instead of exiting 1 when Redis is absent.
- B. Own strategy, retry forever with capped exponential delay and jitter, plus a startup deadline. Testable as a pure function. **Chosen.**
- C. Keep 10 attempts and add a supervisor that calls `connect()` again after the client terminates. More moving parts and a window in which every command fails; no benefit over B.

## Consequences

- Redis loss no longer answers 500 or a spurious 401 on authenticated routes, and no longer answers 500 after a committed proposal, interview or Connects purchase. Each request served during an outage costs one extra database read for auth and, on Connects routes, one for the balance.
- Sliding-TTL caveat: a cache write skipped during an outage can leave an older Connects balance in Redis, and the `expire` on each cache hit keeps it alive. Overspending is still blocked by the guarded debit in `connects.repository.ts`; only the displayed balance may lag until the key is evicted. A follow-up could `del` the key when a write fails.
- A Redis that never recovers costs nothing but repeated `redis.error` logs (one per reconnect attempt, at most one every 5 s); `cache.redis.degraded` is throttled.
- Alert on `cache.redis.degraded` and `redis.error`. There is no metrics library; these logs are the signal and are candidates for counters once OpenTelemetry lands.
- Tests: `infrastructure/cache/redis.client.test.ts`, `infrastructure/cache/fail-open.cache.test.ts`, `modules/auth/tests/auth.redis-fail-open.integration.test.ts`, and Redis-failure cases in the Connects, proposals and admin contract tests.
