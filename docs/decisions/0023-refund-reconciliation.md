# 0023: Refund reconciliation

Status: accepted. The service, the persisted facts, the cron and the `REFUND_RECONCILIATION_MODE` switch are implemented. The default mode is `detect`; switching to `on` is a deliberate rollout step (see Rollout).

## Context

Declining or withdrawing a `PENDING` contract cancels it in one short transaction and refunds the first milestone payment afterwards, outside the transaction (ADR 0007, item c). When that refund call failed, the contract stayed `CANCELLED`, the client's money stayed captured and nothing was stored about it: no cancel time, no refund result, no retry state. The only repair was for someone to repeat the decline or withdraw call, and the other party was not notified by the failed attempt. Money could be stuck indefinitely without anyone knowing.

## Decision

1. **Persisted facts.** Migration `0009_contracts_cancel_refund_facts` adds `cancelled_at`, `cancelled_by` (`CLIENT` or `TALENT`), `refund_id` and `refunded_at` to `contracts`. The cancelling `UPDATE` sets the first two; one guarded update after a successful refund sets the last two. Migration `0010_contracts_refund_reconciliation` adds `refund_attempts` (integer, default 0, `>= 0`), `refund_next_attempt_at` (lease or backoff time), `refund_last_error` (short code) and the partial index `contracts_refund_retry_idx`. The rows to repair are `status = 'CANCELLED' AND refunded_at IS NULL`. Rows cancelled before migration 0009 have NULL cancel facts (legacy rows).
2. **Winner rule for notifications.** Recording a refund is `UPDATE contracts SET refunded_at = ... WHERE id AND status = 'CANCELLED' AND refunded_at IS NULL RETURNING` (`markContractRefundedIfUnrecorded`). Only the caller whose statement returns a row emits the conversation update and sends the notification, through the same `notifyCancellation`, payloads and `eventId` as the cancel path. A repeat decline or withdraw and the reconciler race on the same statement, so exactly one of them notifies and the loser sends nothing.
3. **Stripe is read before it is written.** For each row the payment intent is retrieved with `latest_charge`. If `latest_charge.amount_refunded >= amount_received` (and `amount_received > 0`), the money is already back: the row is recorded as done with no refund call and `refund_id` NULL. Only otherwise is a refund created, by the same helper as the cancel path (`refundContractFirstPayment`; a Refund with status `failed` or `canceled` is a failure, `succeeded` and `pending` count as done, `charge_already_refunded` is done).
4. **Idempotency key policy.** Stripe keeps idempotency keys for about 24 hours. While `cancelled_at` is set and younger than 23 hours the reconciler reuses the cancel path's key `refund:<pi>:requested_by_customer`, so a retry cannot double refund against an earlier attempt that already reached Stripe. After that window, and for legacy rows, the key is `refund:<pi>:requested_by_customer:recon:<refund_attempts at claim time>`; the Stripe read in rule 3 is what prevents a double refund once the old key has expired.
5. **Attempts, backoff and parking.** A failure other than "Stripe unavailable" adds one to `refund_attempts`, stores a sanitized code (Stripe code, else type, else error name; at most 200 characters, never the message) and sets `refund_next_attempt_at = now + min(15 minutes * 2^(attempts before), 24 hours)`. The 20th attempt parks the row. The permanent codes `charge_not_refundable`, `refund_disputed_payment` and `resource_missing` park it at once (`refund_attempts = 20`, `refund_next_attempt_at` NULL, log `refund.reconcile.parked` at error level). A connection error, rate limit, or status 429 or 5xx consumes no attempt and releases the lease; three such failures in one run release the remaining leases and stop the run (`aborted`). A parked row never returns to the claim query by itself.
6. **Lease and claim.** In mode `on`, one `UPDATE ... SET refund_next_attempt_at = now + 10 minutes WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING` claims the batch. Two runs, in one process or in several API instances, never take the same row, and a crashed run's rows come back when the lease expires. Candidates are at least 5 minutes past `cancelled_at` (so a refund still in flight in the cancel path is not raced), ordered by `refund_next_attempt_at NULLS FIRST, id`, 50 per run.
7. **Scheduling.** `contracts.cron.ts` schedules `reconcileCancelledContractRefunds` with `*/15 * * * *`. There is no run at boot; the first run is the first tick. A tick that finds the previous run still in flight is skipped with a debug log (`refund.reconcile.skipped_overlap`); the guard is per process, and the claim in rule 6 covers several processes. The handler catches every error and logs `refund.reconcile.failed` at error level with the error code, or the error name when there is no code, and never the message; the guard is released in a `finally`. `start` begins the cron after the server listens, next to the payout cron. `shutdown` stops both crons first, then waits for the in-flight payout and reconciliation runs together under one bound (`PAYOUT_DRAIN_TIMEOUT_MS`), logs `system.shutdown.refund_reconciliation_run_timeout` and continues if the bound is hit, and only then closes the HTTP server and the pool. Bootstrap imports the cron only through `modules/contracts/index.ts`.
8. **Modes.** `REFUND_RECONCILIATION_MODE` is `off`, `detect` or `on`, default `detect` in every environment.
   - `off`: nothing is scheduled; one info log `refund.reconcile.disabled` at startup.
   - `detect`: reads candidates and Stripe and writes nothing; each stuck contract is logged as `refund.reconcile.detected` with the contract id and its age.
   - `on`: claims, refunds and records.

   Without a Stripe key a run logs `refund.reconcile.skipped` and touches nothing. An invalid value stops startup with the usual env error.

## Rollout

1. Deploy with the default (`detect`). Nothing is written to `contracts`; the run costs one candidate query and one Stripe read per candidate every 15 minutes.
2. For a few days, read the `refund.reconcile.detected` logs. Because `detect` stores nothing, the same contract is logged again on every tick; count distinct contract ids. Check that each one is a real stuck refund and that the ages are plausible.
3. Set `REFUND_RECONCILIATION_MODE=on`. Watch `refund.reconcile.run` (one summary line per run that scanned anything), `refund.reconcile.parked` and the error-level `refund.reconcile.failed`.
4. `off` is the kill switch: set it and restart. Rows keep their state; nothing is lost.

`refund.reconcile.failed` is used twice. The service logs it at warn level for each retried refund failure (with a contract id); the cron logs it at error level when a whole run throws (with the mode and an error code, no contract id). Filter by level.

## Operator reset of a parked row

After the cause is fixed (for example a disputed payment resolved), a parked row is made eligible again with:

```sql
UPDATE contracts
SET refund_attempts = 0, refund_next_attempt_at = NULL, refund_last_error = NULL
WHERE id = '<contract id>' AND status = 'CANCELLED' AND refunded_at IS NULL;
```

Only `refund_attempts = 0` is required; clearing the other two makes the row due at once. Find parked rows with `refund_attempts >= 20 AND refunded_at IS NULL AND status = 'CANCELLED'`.

## Known limits

- Legacy rows (`cancelled_by` NULL) are recorded as refunded but get no emit and no notification.
- For an agency contract declined by a member, the declining member is not stored, so the `TALENT` conversation update has no excluded user and also reaches the declining member.
- A crash after the guarded update that records the refund but before the notification is sent loses that one notification; no later run notifies because the row is no longer a candidate.
- Orphan paid sessions are not handled: a paid checkout session that never produced a contract, or whose contract could not be created, is outside this job. It is parked as follow-up work; a detect-only job (implemented, no refunds) is described in ADR 0008, "Orphan paid sessions, follow-up".
- In `detect` the same rows are logged on every tick.
- The job refunds only the first milestone payment, as the cancel path does.

## Consequences

- A failed refund after a decline or withdraw is retried without anyone repeating the call, and the other party is notified once when it succeeds.
- Because the default is `detect`, a deploy never moves money until an operator sets `on`.
- Two new bootstrap steps (`refund reconciliation cron` and the combined `background runs` drain) share the existing shutdown bound, so shutdown time does not grow with the number of jobs.
- No migration, route or response shape changes in this step; `docs/api/openapi.json` is unchanged.

## Update (2026-11-20): notice in the recording transaction

ADR 0024 (sub-batch 3) writes the CONTRACT_DECLINED and CONTRACT_WITHDRAWN row in the same transaction as the guarded `refunded_at` update (`recordRefundWithNotice`), so the crash window in the consequences above is closed for refunds recorded from now on. A contract that already has `refunded_at` and no notice row is not re-sent. The emit, the push and the `refund.reconcile.notify_failed` log run after commit; a failing emit no longer matters for the stored notice.

## Update (2026-11-20): the claim computes its ids once

`claimRefundCandidates` is one statement, `WITH picked AS MATERIALIZED (SELECT id ... ORDER BY ... LIMIT n FOR UPDATE SKIP LOCKED) UPDATE contracts ... FROM picked WHERE contracts.id = picked.id RETURNING ...`. The earlier `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)` could return more than `limit` rows: when the planner believed the table was empty (statistics gathered while it was empty) it chose a Nested Loop Semi Join with the limited subquery as an un-materialized inner side, so the subquery re-ran for each outer row and `SKIP LOCKED` skipped the rows this same statement had already updated, which let every re-run pick new ones (3 rows for limit 2, 52 for limit 50). The CTE is evaluated exactly once whatever the plan. The WHERE, ordering, lease value and returned columns are unchanged; a test forces the nested loop plan with `SET LOCAL` and fails on the old shape. The payout claim (ADR 0005) is not affected: it locks a single row by primary key and has no `LIMIT`.
