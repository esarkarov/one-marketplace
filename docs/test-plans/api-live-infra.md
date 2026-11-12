# Test plan: Stage 3c manual verification on live infra

## Scope

Uncommitted Stage 3c work in `services/api` and `infra/scripts/test-db.mjs`: Daily webhook signature check (`meetings.controller.ts`), `db:test:create|migrate|setup` scripts, admin Redis routes (`admin-redis.ts`, `GET /system/redis/keys`, `GET /system/redis/keys/:key`), per-user rate limiters (`user-rate-limit.middleware.ts`) and the CI `api-test` job. Unit tests cover these against stubs; nothing below was run because Docker, real Redis, Daily and CI are not available in the QA session.

Use throwaway credentials only. Never use or print the real `.env`.

## Automated run (for reference)

- `pnpm check`: passes (0 lint errors; existing `no-explicit-any` and `no-img-element` warnings only).
- `pnpm -r --no-bail build`: passes.
- API vitest with throwaway DATABASE_URL, TEST_DATABASE_URL and REDIS_URL, excluding the two infra-dependent files: 20 files, 315 tests passed.
- `src/app.test.ts` and `src/modules/jobs/jobs.route.test.ts`: hook timeout (10 s) on `connectRedis`/DB, 26 tests skipped. Needs Docker; unverified.

Legend: U unit, I integration, E end to end / manual.

## 1. Daily webhook real delivery

Preconditions: API running with `DAILY_WEBHOOK_SECRET` set to the base64 secret Daily shows for the webhook; Redis up; public tunnel to `POST` the webhook route; Daily room with the webhook registered.

| #   | Scenario                            | Steps                                                                                                                                 | Expected                                                                                                                                             | Type |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1.1 | Real delivery verifies on raw bytes | End a real meeting; capture request headers and raw body at the API (log only booleans, not the secret)                               | 200; signature matches `HMAC-SHA256(base64-decoded secret, "<timestamp>.<raw body>")` on the raw-bytes path                                          | E    |
| 1.2 | Fallback path (re-serialized JSON)  | Record whether real payloads ever fail raw-bytes but pass `JSON.stringify(parsed)`; replay a body with different whitespace/key order | Document which path real Daily uses; if fallback is never needed, flag it for removal; if needed, 200 only on fallback                               | E    |
| 1.3 | Timestamp units                     | Inspect the real `x-webhook-timestamp`: seconds (10 digits) or ms (13 digits)                                                         | Accepted either way; the `1e12` threshold classifies it correctly; record the unit Daily sends                                                       | E    |
| 1.4 | Stale and future timestamps         | Replay a captured valid delivery after 6 minutes; send one with timestamp +6 min                                                      | 401/rejected both times; within +-5 min accepted                                                                                                     | E, U |
| 1.5 | Bad signature and missing headers   | Alter one body byte; drop each header; non-numeric timestamp                                                                          | Rejected, no side effects, no secret in logs                                                                                                         | U, I |
| 1.6 | Dedupe                              | Redeliver same event id within 10 min; then after TTL; stop Redis and deliver                                                         | Second ignored (key `webhook:daily:*` with ~600 s TTL); after TTL processed; Redis down: 2 s timeout, logs `dedupe_unavailable`, behavior documented | I, E |
| 1.7 | Secret unset                        | Start without `DAILY_WEBHOOK_SECRET`                                                                                                  | All deliveries rejected                                                                                                                              | U    |

Edge: unicode or large bodies (byte-exact verification), duplicate header values, body parsed by `express.json` before the route (must be raw Buffer).

## 2. Test DB scripts through docker exec (Windows cmd)

Preconditions: Docker Desktop running, `pnpm infra:up`, root `.env` present (not read by QA), shell is Windows `cmd.exe`, then repeat in PowerShell and Git Bash.

| #   | Scenario                     | Steps                                                                                                        | Expected                                                                                                    | Type |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---- |
| 2.1 | `db:test:create`             | `pnpm --filter @onemarketplace/api db:test:create`                                                           | Container name read from compose; `onemarketplace_test` created through `docker exec ... psql`; exit 0      | E    |
| 2.2 | Idempotent create            | Run 2.1 again                                                                                                | Exit 0, no error, DB untouched                                                                              | E    |
| 2.3 | `db:test:migrate`            | Run after 2.1                                                                                                | Migrations applied to the test DB only; dev DB unchanged (compare `\dt` in both)                            | E    |
| 2.4 | `db:test:setup`              | Drop test DB, run `pnpm --filter @onemarketplace/api db:test:setup` in cmd (`&&` chaining inside the script) | Create then migrate succeed; second run still succeeds                                                      | E    |
| 2.5 | Name guard                   | `TEST_DATABASE_URL` ending in `/onemarketplace`, `/foo`, or equal to `POSTGRES_DB`                           | Refuses, exit 1, nothing executed                                                                           | I    |
| 2.6 | Host guard                   | Remote host, `0.0.0.0`, hostname with look-alike                                                             | Refuses; `localhost`, `127.0.0.1`, `[::1]` accepted                                                         | I    |
| 2.7 | Injection and quoting        | DB name with quote, space, uppercase, unicode; password with `@`, `%`, `'`, spaces                           | Name rejected by pattern; password never appears in argv/logs; special characters work                      | I, E |
| 2.8 | Docker missing / not running | Stop Docker, run create                                                                                      | Clear error, non-zero exit, no stack with credentials. Check whether a non-docker fallback exists and works | E    |
| 2.9 | Only `DATABASE_URL` set      | Unset TEST_DATABASE_URL                                                                                      | Target derived as `<name>_test`; neither variable set gives "Set TEST_DATABASE_URL or DATABASE_URL."        | I    |

Also: confirm `src/test/setup/assert-test-database.ts` blocks tests when URL points at a non-test DB.

## 3. Admin Redis routes against real Redis

Preconditions: API + Redis up, admin token, non-admin token (client), seeded keys: `account:auth:<id>`, `connects:<id>`, `webhook:daily:<id>`, and `other:secret`.

| #   | Scenario              | Steps                                                                                                    | Expected                                                                                                            | Type |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| 3.1 | Authz                 | Call both routes with no token, client token, admin token                                                | 401, 403, 200                                                                                                       | I, E |
| 3.2 | Scan allowed prefixes | `?pattern=connects:*`, `account:auth:*`, `webhook:daily:*`                                               | Matching keys only; large keyspace (10k+) returns without blocking Redis (SCAN, not KEYS) and with a bounded result | E    |
| 3.3 | Pattern validation    | Pattern `*`, `other:*`, `connects*` variants, 65+ chars, `[`, `\`, spaces, missing                       | 400, no Redis call. Check `connects:*` prefix bypass such as `connectsX:*`                                          | U, I |
| 3.4 | Get key               | `/system/redis/keys/connects:<id>`; non-allowed `other:secret`; missing key; 129-char key; encoded `%3A` | Allowed returns value and TTL; disallowed rejected; missing returns documented not-found                            | I, E |
| 3.5 | Redaction             | Get `account:auth:<id>`; scan with the same prefix                                                       | Value is `[REDACTED]` in the response and in logs; keys visible                                                     | I, E |
| 3.6 | Value types           | Keys holding string, hash, list, large (1 MB) values                                                     | Defined behavior (type reported or error), no crash, no huge payload                                                | E    |
| 3.7 | Redis down            | Stop Redis, call routes                                                                                  | 5xx/503 in standard shape, no connection string leaked                                                              | E    |

## 4. Per-user rate limit 429s

Limiters are skipped when `NODE_ENV=test`, so run the built server with `NODE_ENV=development` and real Redis/DB. Limits per 15 min window: content writes 30 (jobs create and update, freelancer profile, agency), message send 120.

| #   | Scenario                   | Steps                                                          | Expected                                                                                                        | Type |
| --- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| 4.1 | 429 at the limit           | Same user sends 31 valid `POST /jobs`                          | First 30 succeed; 31st returns 429 `{ success: false, message, requestId }` with `RateLimit-*` headers          | E    |
| 4.2 | Per-user isolation         | While user A is limited, user B (same IP) calls the same route | B is not limited                                                                                                | E    |
| 4.3 | Shared vs separate buckets | Check create-job vs update-job vs profile vs agency counters   | Each `contentWriteLimiter()` instance has its own counter (confirm intended; a user could do 30 per route)      | E    |
| 4.4 | Message limit              | 121 messages in a conversation                                 | 121st is 429; reads unaffected                                                                                  | E    |
| 4.5 | Order vs auth/validation   | Unauthenticated and invalid-body requests over the limit       | Unauthenticated falls back to IP key; invalid requests: confirm whether they count and whether 401 precedes 429 | E    |
| 4.6 | Window reset               | Wait out the window (or lower the window locally)              | Requests succeed again; `Retry-After` accurate                                                                  | E    |
| 4.7 | Multi-instance             | Two API processes                                              | Counters are in memory, so limit is per process; record as known gap (not Redis-backed)                         | E    |
| 4.8 | Proxy / IPv6               | `TRUST_PROXY` on/off, IPv6 clients                             | IPv6 keyed by subnet via `ipKeyGenerator`; no shared bucket for all users behind proxy when authed              | E    |

Blocked on a decision: whether 30 and 120 per 15 min are the intended product limits (not in `docs/product.md`).

## 5. CI `api-test` job

Preconditions: push a branch and open a PR (QA cannot run GitHub Actions locally).

| #   | Scenario            | Steps                                                                                              | Expected                                                                                                                                                                             |
| --- | ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 | Green run           | Open PR with current changes                                                                       | Postgres 18 service healthy, Redis container answers PONG, `db:test:migrate` succeeds, all tests pass including `app.test.ts` and `jobs.route.test.ts` (26 tests unverified locally) |
| 5.2 | Migrate on empty DB | Check the job log for `db:test:migrate`                                                            | Works without `db:test:create`, because the service creates `onemarketplace_test`; confirm no Docker call is needed in CI (docker exec path is for local only)                       |
| 5.3 | Redis auth          | Job log for Redis start; ensure `REDISCLI_AUTH` is passed without echoing the password (`-e` form) | Connection with `REDIS_URL` password works; password is masked or throwaway only                                                                                                     |
| 5.4 | Failure modes       | Break Redis start (wrong image tag) and a failing test on a scratch branch                         | Job fails clearly; `docker logs redis` printed on Redis failure; no hang beyond the 20 min timeout                                                                                   |
| 5.5 | Guard in CI         | Confirm the test-DB guard accepts the CI URL (`127.0.0.1`, name ends `_test`)                      | No refusal                                                                                                                                                                           |
| 5.6 | Pins and secrets    | Review the job                                                                                     | Actions pinned by SHA, `persist-credentials: false`, gitleaks job passes on the new files                                                                                            |

## Known unverified at QA time

- `src/app.test.ts`, `src/modules/jobs/jobs.route.test.ts` (Docker needed).
- Everything in sections 1 to 5 (live Daily, Docker on Windows, real Redis, CI).
