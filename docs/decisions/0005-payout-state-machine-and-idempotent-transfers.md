# 0005: Payout state machine and idempotent Stripe transfers

Status: accepted

## Context

State of the code BEFORE this change (the line references below describe that code, not the current code):

- The hourly cron (`payouts.cron.ts`, `noOverlap: true`) calls `processDuePayouts`. It selects earnings older than the hold with no `payout_history` row (`payouts.service.ts:42-87`).
- It calls `stripe.transfers.create` (`payouts.service.ts:159-179`) before it inserts the `payout_history` row (`:181`).
- The idempotency key is `payout:${earningHistoryId}:${accountId}:${runId}` (`:177`) with `runId = Date.now()` (`:39`). It changes on every run, so it protects nothing.
- Two API instances, or a crash between Stripe and the insert, can pay the same earning twice. The `UNIQUE(earning_history_id)` constraint fires only after the money moved, and `:252` treats error 23505 as "skipped".
- The notification is sent after payment (`:210`) with a fresh envelope id, so the consumer's `notifications.event_id` dedupe (ADR 0004) cannot catch a duplicate.
- `noOverlap` is per process, so it does not protect several instances.
- No payout webhooks exist and no HTTP route triggers payouts.
- The hold is 5 days and the platform fee is 10% (`config/constants.ts:61-65`). Fee model and clearance period are still "to confirm" in `docs/product.md`.

## Decision

Everything below is the decision and is implemented in `services/api/src/modules/payouts`.

### Record and schema

- `payout_history` stays the payout record. One payout per earning is already guaranteed by `UNIQUE(earning_history_id)`, and one earning per milestone by `earning_history.milestone_id UNIQUE`. No new unique index is needed and there is no "period" concept.
- New columns: `status`, `attempts`, `claimed_at`, `next_retry_at`, `paid_at`, `notified_at`, `idempotency_key`, `last_error`, `destination_account_id`. `stripe_transfer_id` becomes nullable.
- `CHECK ((status = 'PAID') = (stripe_transfer_id IS NOT NULL))`.
- Backfill: existing rows all carry a transfer id and become `PAID`, with `paid_at` and `notified_at` set to `created_at`.
- The migration is a new file (`0001`). `0000_init` is never edited.

### State machine

`PENDING -> PROCESSING -> PAID | FAILED`. `PAID` is terminal.

| From         | To           | Condition                                         |
| ------------ | ------------ | ------------------------------------------------- |
| `PENDING`    | `PROCESSING` | claim                                             |
| `FAILED`     | `PROCESSING` | `next_retry_at <= now()`                          |
| `PENDING`    | `FAILED`     | non-retryable validation failure (invalid amount) |
| `PROCESSING` | `PAID`       | transfer confirmed                                |
| `PROCESSING` | `FAILED`     | transfer failed                                   |
| `PROCESSING` | `PROCESSING` | stuck takeover: `claimed_at < now() - 15 minutes` |

All writes go through one function in `payout-state.ts` that builds a guarded `UPDATE ... WHERE id = $1 AND status = ANY(allowed_from) ... RETURNING`. No other code updates `status`.

### Row creation and claim

- Rows are created with `INSERT ... SELECT <due earnings> ON CONFLICT (earning_history_id) DO NOTHING`, so a crash cannot leave an unpaid earning without a row.
- The claim is a per-row guarded `UPDATE ... FROM (SELECT ... WHERE id = $1 FOR UPDATE SKIP LOCKED) old ... RETURNING`. It is not a batch selection: the cron selects candidates, then claims them one by one. Only the caller that gets a row back may call Stripe.
- The claim returns the pre-claim values (`prev_claimed_at`, `prev_idempotency_key`). A "previous claim exists" when either was set before this claim; this, not the attempt counter, gates list-before-create, so resetting `attempts` to 0 in manual recovery does not disable it.
- `destination_account_id` is written once, on the first claim, and never overwritten (`COALESCE`). Later claims compare it with the recipient's current Connect account.
- Stripe is called outside any database transaction.
- No Redis or advisory lock. The claim is the guard across instances; `noOverlap` stays as a per-process convenience only.

### Amounts

- The amount is validated before claiming: finite and at least 1 minor unit after rounding. Otherwise the payout goes to `FAILED`, non-retryable (`next_retry_at` NULL), with `last_error` set to a short code, never a raw message.
- Conversion to minor units goes through one helper, `utils/money.ts` `toMinorUnits` (`Math.round`), so the later decimal or integer money work replaces it in one place. Amounts stay floats in this stage.

### Stripe call

- `transfers.create` with `transfer_group` `payout:<payout_id>`, metadata `{ payoutId, earningHistoryId }` and `Idempotency-Key` `payout:<payout_id>:<n>`. `n` starts at 1 and is stored in `payout_history.idempotency_key`.
- The Stripe client timeout is set explicitly to 30 s, well below the 15-minute takeover.
- Unknown outcome: crash after claim, timeout, network error, 5xx, HTTP 409, HTTP 429, `idempotency_key_in_use`, any `StripeIdempotencyError` (whatever its HTTP status, for example a 400 parameter mismatch), and any failure of the `transfers.list` call. Retry later with the same key and never bump `n`. Before any retry (a previous claim exists, see above), list transfers by `transfer_group` and destination and adopt a matching transfer (amount, currency) instead of creating one. We do not wait for the 24 h key expiry; the idempotency key is the second line of defense.
- Definitive rejection (any other 4xx from `transfers.create`): mark `FAILED` and bump `n` for the next attempt, because Stripe replays stored 4xx results for the same key. `last_error` stores the Stripe error code or type only.
- Destination change: when a previous claim exists and the stored `destination_account_id` differs from the recipient's current account, the code never creates. It lists by `transfer_group` without a destination filter. A matching transfer is adopted (`payout.recovered`, reason `adopted_transfer_other_destination`). Otherwise the payout is parked: `PROCESSING -> FAILED`, `next_retry_at` NULL, `last_error` `destination_changed`, plus an error-level `payout.exhausted` (ids and reason only). A human decides.
- Reversed transfers: an adoption candidate with `reversed = true` or `amount_reversed > 0` is not adopted. The payout is parked the same way with `last_error` `transfer_reversed`. Other reversal handling stays out of scope.

### Retry policy

`FAILED` payouts retry with backoff by attempt: 5 min, 30 min, 2 h, 12 h, 24 h. After 5 attempts the payout stays `FAILED` with `next_retry_at` NULL and an error-level `payout.exhausted` event for manual review.

### Logging

Structured pino events, no secrets, no raw Stripe messages: `payout.claimed`, `payout.paid`, `payout.failed`, `payout.recovered` (adopted an existing transfer, or a stuck takeover) and `payout.exhausted` (error level). `FAILED` payouts send no notification; they are only logged.

### Notifications

- Sent only when the `PROCESSING -> PAID` update returned a row.
- The envelope event id is deterministic (uuid v5 of the payout id; `sendNotification` gets an optional `eventId`), so the consumer's unique `notifications.event_id` (ADR 0004) is the last duplicate guard.
- `sendNotification` never throws and returns `"published" | "disabled" | "failed"`. `failed` covers a disconnected broker, publish errors and nacks.
- `notified_at` is set only for `published` or `disabled` (RabbitMQ not configured: nothing can ever be delivered, so the sweep must not retry forever). On `failed` it stays NULL, so the next hourly sweep of `PAID` rows with `notified_at IS NULL` retries with the same deterministic event id. The sweep also covers a crash after `PAID`.
- A retry can publish the same event id twice (for example after a publish that succeeded but was reported as failed); the consumer's unique `notifications.event_id` dedupes it.

### Readers

Every place that derives "paid" from the existence of a `payout_history` row must filter `status = 'PAID'`. Known today: `freelancer.service.ts:279-286`, `agency.service.ts:347-354`, `admin.service.ts:112` and `admin.service.ts:559-579`. The implementation greps exhaustively and the final list goes in the implementation report.

### Debt recorded

The payouts module reads `earning_history`, `accounts` and `agency_metadata` directly, which breaks the module rule in `docs/architecture.md`. It is kept for now and will be replaced by public interfaces of contracts, freelancer and agency later.

### Out of scope

Float-to-decimal/integer money (Stage 5b), refunds, disputes, transfer reversals, `transfer.*` webhooks, a withdrawal UI, and changes to the 5-day hold, the 10% fee or the `usd` currency.

Known unrelated follow-up, not fixed here: `reviewContractMilestone` (`contracts.service.ts:1048-1107`) reads the milestone status outside its transaction and updates without a status guard. A double approve fails with a 500 from the `earning_history.milestone_id` UNIQUE (the transaction rolls back, so there is no double earning) instead of a 409.

## Manual recovery procedure

For exhausted or parked (`destination_changed`, `transfer_reversed`) `FAILED` payouts. The operator needs database and Stripe dashboard access. The SQL is an example to review against the real schema, not to paste blindly.

1. Find candidates and read the cause:

   ```sql
   SELECT id, earning_history_id, attempts, last_error, destination_account_id
   FROM payout_history
   WHERE status = 'FAILED' AND next_retry_at IS NULL;
   ```

2. In the Stripe dashboard, search transfers by transfer group `payout:<id>`.
3. a. A transfer exists. Record its id and mark the payout paid in one transaction. `notified_at` stays NULL so the sweep sends the notification:

   ```sql
   BEGIN;
   UPDATE payout_history
   SET stripe_transfer_id = 'tr_VERIFIED_IN_STRIPE',
       status = 'PAID',
       paid_at = TIMESTAMPTZ '2026-01-01 12:00:00+00' -- the transfer creation time in Stripe
   WHERE id = '<payout id>' AND status = 'FAILED';
   COMMIT;
   ```

   b. No transfer exists for the transfer group, in any destination account (verified in Stripe), and the cause is fixed. Reset so the cron retries under the normal rules. The idempotency key moves to a fresh suffix and the stored destination is cleared, so the next claim records the current destination. An operator must never reuse a key with different parameters, and must not reset before the Stripe check:

   ```sql
   UPDATE payout_history
   SET status = 'FAILED',
       attempts = 0,
       next_retry_at = now(),
       destination_account_id = NULL,
       idempotency_key = 'payout:' || id::text || ':' || (
         COALESCE(NULLIF(split_part(idempotency_key, ':', 3), ''), '1')::int + 1
       )::text
   WHERE id = '<payout id>' AND status = 'FAILED' AND stripe_transfer_id IS NULL;
   ```

   `claimed_at` is kept on purpose: it makes the next claim list transfers before creating one.

4. Never set `PAID`, and never write `stripe_transfer_id`, for a transfer that was not verified in Stripe.
5. Record what was done (payout id, transfer id or reset reason, operator, time) in the team's incident or ops notes.

## Consequences

- Cron behavior: rows are created first, claimed, then paid; a crash or a second instance can no longer cause a second transfer. Payouts that fail are retried with backoff instead of being re-selected every hour.
- Readers must filter `status = 'PAID'`; a missed reader would count unpaid rows as paid.
- New structured logs (`payout.*`) and extra Stripe list calls, only on recovery after an unknown outcome.
- Notifications become exactly-once at the consumer through the deterministic event id, plus the `notified_at` sweep (see the notified_at rule above).
- Five consecutive unknown outcomes leave the payout `FAILED` with `next_retry_at` NULL and a `payout.exhausted` event; it needs manual review.
- A non-positive net earning (`amount - platform_fee_amount <= 0`) cannot get a payout row because of the `amount > 0` CHECK. It is skipped and logged on every hourly run (`non_positive_net_amount`).
- Open design point: the `invalid_amount` branch is unreachable with the current schema, because the `amount` CHECK already rejects values below one minor unit. The branch stays as defense in depth until the Stage 5b money work decides whether to keep it.
- Sweep race: two overlapping runs (several instances) can both publish the same event id for one `PAID` row. The consumer's unique `event_id` dedupes it.
- A destination change after a previous claim always parks the payout, including after a definitive failure, until an operator resets it (recovery step 3b clears the stored destination).
- Risks: Stripe idempotency keys expire after 24 h, which is why recovery lists transfers by `transfer_group` first. Cron `noOverlap` is per process only, so correctness rests on the database claim.
- Verification plan: real-Postgres tests against the `_test` database with Stripe mocked (claim races, takeover, retry, backoff, backfill, readers). Real Stripe behavior (idempotency replay, `transfer_group` listing, error codes) is not verified without real keys.
