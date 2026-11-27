# 0028: External call resilience wrapper

Status: accepted (2026-11-27, learning roadmap item 1.3). Label: adopted for learning.

## Context

Calls to Daily and Clerk each had their own ad hoc handling: Daily had an 8 s `AbortSignal.timeout` and `DailyRequestError` (wave 1 item 32), signup retried `clerk.users.getUser` on any error after 300 ms and 600 ms, and the display sync raced `getUser` against its own 2 s timer. Nothing was measured, the retry rule differed per call site, and the signup retry also repeated client errors. The roadmap (`docs/research/backend-evolution/04-learning-roadmap.md`, Part 3, 1.3) asks for one place that owns timeouts and bounded retries, with the rule that only idempotent calls retry.

## Options

| Option                             | For                                                                                     | Against                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A library now (cockatiel, opossum) | Tested breaker, bulkhead and retry; less code to own                                    | New dependency under `minimumReleaseAge`; hides the mechanics this item is meant to teach; breakers are not needed at current traffic |
| Own small wrapper (chosen)         | No dependency; every rule (classification, budget, observer) is visible and tested here | Timeout and retry only; no breaker or bulkhead                                                                                        |

The libraries are compared again in roadmap item 4.1. The wrapper has no breaker or bulkhead and no placeholder for them; the `circuit_open` outcome in `telemetry/metrics.ts` stays reserved for that item.

## Decision

- `callExternal(policyKey, run, { signal })` in `infrastructure/utils/external-call.utils.ts`; policies in `EXTERNAL_POLICIES` (`infrastructure/constants/index.ts`); types in `infrastructure/types/external-call.types.ts`. `callWithPolicy` takes an explicit policy for tests.
- A policy is `{ target, operation, timeoutMs, idempotent, retry? }`. The type forbids `retry` unless `idempotent: true`, and a unit test asserts it over the whole table (a mutation that lets `daily.createRoom` retry fails both tsc and the test).
- Each attempt runs with `AbortSignal.any([AbortSignal.timeout(timeoutMs), callerSignal])` and is raced against that signal, so a call that ignores the signal still ends at the timeout. A timeout is the timeout signal having fired while the caller's did not; error names are never used. A caller abort ends the call at once, also during backoff, with kind `aborted`.
- Backoff is full jitter, `floor(random() * min(maxMs, baseMs * 2^n))`, with an injectable random source. A retry happens only if elapsed time plus the delay leaves at least `EXTERNAL_MIN_ATTEMPT_MS` (100 ms) of `totalBudgetMs`, and each attempt's timeout is capped by the remaining budget.
- `EXTERNAL_CALL_RETRIES=on|off` (default `on`): `off` gives one attempt; timeouts stay.
- Failures become `ExternalCallError { policyKey, kind, status?, attempts, cause }`. An error that fits no class (no status, no listed network code, no fired signal) is not retried and is rethrown unchanged. `DailyRequestError` wraps the `ExternalCallError` with the same message, `status` and `timedOut` as before, so the 502 mapping in `meetings.service.ts` and every client-visible status and message are unchanged.
- Observability: `reportExternalCall` (ADR 0026) is called once per call with `service` (policy target), `operation`, `outcome` (`success`, `failure`, `timeout`, `aborted`), `attempts` and `durationMs`; all values come from the policy table, so cardinality is fixed. `external.call.failed` (warn) is logged once per failed call that was not a caller abort, `external.call.retry` (debug) per retry, both with policy, outcome or kind, attempts and status only: never URLs, headers, bodies or error messages. With `TELEMETRY_MODE=off` no observer is registered and reporting is a no-op.

### Retry classes

| Class                                  | Detected by                                                                                                   | Retried (idempotent policy with `retry`) |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Timeout                                | the per-attempt timeout signal fired, the caller's did not                                                    | yes                                      |
| Network                                | `code` on the error or its `cause` chain: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `UND_ERR_*` | yes                                      |
| Status 429, 502, 503, 504              | numeric `status` on the error                                                                                 | yes                                      |
| Other status (all other 4xx, 500, 501) | numeric `status`                                                                                              | never                                    |
| Caller abort                           | the caller's signal                                                                                           | never, ends at once                      |
| Anything else                          | no class matched                                                                                              | never, rethrown unchanged                |

### Policies

| Policy                 | Timeout | Idempotent              | Retry                                       |
| ---------------------- | ------- | ----------------------- | ------------------------------------------- |
| `daily.createRoom`     | 8 s     | no (no idempotency key) | none                                        |
| `daily.createToken`    | 8 s     | yes                     | max 1, base 200 ms, cap 1 s, budget 12 s    |
| `clerk.signup.getUser` | 5 s     | yes                     | max 2, base 300 ms, cap 600 ms, budget 10 s |
| `clerk.syncDisplay`    | 2 s     | yes                     | none                                        |

`daily.createToken`: the request only signs a token for an existing room name (`is_owner: false`, `exp`); it changes no room, and tokens are minted per request and never stored (ADR 0021), so a duplicate from a retry is unused and expires with the other. Daily has no other read call in the client. `clerk.signup.getUser` keeps the old 300 ms and 600 ms as the jitter caps of its two retries.

## Not adopted here

- Stripe: the SDK retries internally with idempotency keys (`https://docs.stripe.com/api/idempotent_requests`) and the money path is out of scope.
- ImageKit: uploads have no idempotency key and must not retry.

Both are roadmap 4.1 follow-ups.

## Consequences

- Signup no longer retries Clerk client errors (for example 404) or errors that fit no class; it now has a 5 s per-attempt timeout where it had none. A 4xx from Clerk still answers 500 through the error handler, as before.
- The Clerk SDK `getUser` takes no signal, so a timed-out attempt keeps running in the background while the next one starts; signup can briefly have up to three reads in flight. They are idempotent GETs and the race consumes their rejections.
- The runtime also refuses to retry a policy whose `idempotent` is false, even if a cast slips a `retry` past the type.
- Meeting join gains at most one token retry; room creation is unchanged.
- `auth.display.test.ts` counts the `account.display_sync.failed` warning instead of all warnings, because the wrapper adds `external.call.failed`.
- Reverse: `EXTERNAL_CALL_RETRIES=off`, or revert.
