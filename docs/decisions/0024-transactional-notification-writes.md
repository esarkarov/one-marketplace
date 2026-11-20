# 0024: Transactional notification writes

Status: accepted (sub-batches 1 and 2 of 4 implemented)

## Context

An inventory of after-commit side effects (2026-11-19) found that `sendNotification` only publishes an envelope to RabbitMQ. The `notifications` row is written by the consumer, after a broker hop (ADR 0004). So:

- RabbitMQ is optional for the API to start, but it is the only way a notification row exists. Without `RABBITMQ_URL` nothing is stored or pushed.
- While the broker is disconnected, `sendNotification` logs `queue.publish.skipped` and drops the notice with no record. Callers ignore the result.
- The crash window between commit and publish is milliseconds. The dominant loss is a broker outage, not a process death.
- Only two flows pass a deterministic event id (cancel notice, payout notice). Every other call uses a random id, so a caller that runs twice is not deduplicated.
- The payout sweeper (`sweepUnnotified`) marked a row notified when RabbitMQ was disabled, so those notices were never delivered. Fixed in this sub-batch.

## Decision

1. Notices that must not be lost are written as a `notifications` row inside the business transaction, with a deterministic `event_id`. The SSE push stays best-effort after commit. Clients refetch `GET /notifications` to recover a missed push.
2. The RabbitMQ publisher and the consumer stay for the nice-to-have set. The consumer's insert stays and deduplicates by `event_id`, so a notice that exists in both paths is stored once.
3. The write goes through `insertNotification(executor, input)` in the new layer-0 module `notification-store`. It takes the executor first, inserts with `onConflictDoNothing` on `event_id`, and returns the row, or null when it already existed.
4. Event ids come from one helper, `notificationEventId(kind, entityId, transition)` in the store: the uuid v5 of `kind:entityId:transition`. Parts must be non-empty and contain no `:`. Existing ids (`contract-cancelled:<id>`, `uuidV5(payout id)`) are not changed in this sub-batch.

### Must-not-lose

CONTRACT_OFFER, MILESTONE_FUNDED, MILESTONE_SUBMITTED, MILESTONE_APPROVED, MILESTONE_CHANGES_REQUESTED, CONTRACT_DECLINED, CONTRACT_WITHDRAWN, PAYOUT_COMPLETED, PROPOSAL_INTERVIEWED, AGENCY_INVITATION.

### Nice-to-have (stay on RabbitMQ)

CONTRACT_ACCEPTED, MILESTONE_ADDED, CONTRACT_COMPLETED, REVIEW_RECEIVED, PROPOSAL_RECEIVED, invitation answered, PROPOSAL_VIEWED, AGENCY_WELCOME_BONUS.

## Why a layer-0 store

`notifications` is layer 5. `payouts` (1) and `agency` (3) cannot import it, and `proposals` (5) is in the same layer. A table has one owner and other modules write it only through the owner's `index.ts` (ADR 0013 section 4, ADR 0014 section 11). So the table and the writer move to a module every caller may import.

- `notification-store` imports no module (its table file imports `agency_metadata` for the foreign key, which table files may do).
- Its `index.ts` exports functions and types, never the table: the architecture tests forbid re-exporting a table. The `notifications` module reads the table through the store's table file, covered by one allowlist entry (`notifications -> notification-store`, read).
- The two read-state updates (`markAllNotificationsRead`, `markNotificationReadForRecipient`) moved into the store with the same SQL, because they are writes to a table the `notifications` module no longer owns.
- Other types (envelope, payload) stay in `infrastructure`; nothing new is re-exported from `notifications`.

## Why not a relay or RabbitMQ as the transport

For a single instance, every must-not-lose effect can be written as a row in the same transaction. A relay (outbox table, lease, backoff, retention) and a broker hop would add moving parts without removing a risk the direct write does not. LISTEN/NOTIFY only wakes a relay that is not built. If an effect appears that cannot be written as a row, revisit.

## Sub-batch plan

1. Foundations (this ADR): the store, the deterministic id helper, the payout `"disabled"` fix, the move of the orphan payment detection test to the serial test project. No call site converted.
2. Contracts: checkout, lifecycle and milestones notices, and the cancel notice written in the same transaction as the cancel and refund facts.
3. Payout notice, proposal interview, agency invitation.
4. Document refetch on reconnect in `docs/frontend-integration-notes.md`; decide whether the consumer path stays.

## Operator note

Alert on the log name `queue.publish.skipped` (and `queue.publish.failed`): after sub-batch 3 only nice-to-have notices can be lost to a broker outage, but an outage is still visible only in logs. `payment.payout.notification_skipped` is a debug log: with RabbitMQ disabled a PAID payout stays unnotified and is retried hourly.

## Consequences

- Payout fix: `notifyPaid` no longer sets `notified_at` when `sendNotification` returns `"disabled"`. The row stays for `sweepUnnotified` and is delivered once the broker is enabled. `"published"` still marks the row (broker-confirmed, replaced by the in-transaction write in sub-batch 3); `"failed"` is unchanged.
- No migration: the table, columns and constraints are unchanged. `docs/api/openapi.json` is unchanged.
- The consumer's behavior is unchanged: store, ack, then SSE push; the insert goes through the store's `insertNotification`.

## Known limits

- SSE has no replay and no `Last-Event-ID`; clients refetch `GET /notifications` after a reconnect.
- Realtime emits (`conversation:update`) can still fail after commit and sometimes fail the request; that is a separate parked item.
- The refund reconciler's cancel notice still has the crash window of ADR 0023 until sub-batch 2.
- Until a call site is converted, it behaves as before.

## Implementation: sub-batch 2, contract notices (2026-11-20)

Five flows now write the `notifications` row inside the business transaction with `insertNotification(tx, ...)`, after the guarded state change and the system message succeeded, and no longer call `sendNotification`. The recipient, type, title, message, link and metadata are the ones the old call built; the content is built once, in the transaction. Nothing else changed in the contracts module: the nice-to-have notices (accepted, milestone added, completed, review received) and the decline, withdraw and cancel notices still use `sendNotification`.

| Flow                        | Function                           | Event id: `notificationEventId(kind, entityId, transition)`                                                 |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CONTRACT_OFFER              | `createContractFromPayment`        | `CONTRACT_OFFER`, contract id, `offer`                                                                      |
| MILESTONE_FUNDED            | `fundContractMilestoneFromPayment` | `MILESTONE_FUNDED`, milestone id, `funded`                                                                  |
| MILESTONE_SUBMITTED         | `submitContractMilestone`          | `MILESTONE_SUBMITTED`, milestone id, `submitted-<id of the system message written in the same transaction>` |
| MILESTONE_APPROVED          | `reviewContractMilestone`          | `MILESTONE_APPROVED`, milestone id, `approved-<id of the review system message>`                            |
| MILESTONE_CHANGES_REQUESTED | `reviewContractMilestone`          | `MILESTONE_CHANGES_REQUESTED`, milestone id, `changes-requested-<id of the review system message>`          |

- Offer and funded transition once (a guarded insert and a guarded `PENDING` to `ACTIVE` update), so a fixed transition is enough. A milestone can be submitted and sent back for changes many times, so those ids carry the id of the system message the same transaction inserts: a new round gets a new id, and the two ids cannot collide with each other because the kind differs.
- A repeated `submit` while the milestone still awaits review is accepted by the existing guard (`ACTIVE` and funded) and writes a new submission message; it therefore also writes a new notice. This is the behavior before this batch (it also sent a second notice) and is not changed here.
- The write goes through the `insertNotification` call of `notification-store`; `contracts` imports it through that module's `index.ts`. The recipient is the Clerk id the flow already had (the contract's freelancer id, the client id, or the agency owner id for the agency case, where the agency id is the target); no lookup and no new table access was needed.
- The push is `pushStoredNotification(row)` in `notifications/index.ts` (`services/notifications.push.service.ts`). It resolves the recipient's public account id and emits over SSE with the same code as the consumer: the consumer's emit is now `pushNotification(row, recipientAccountId)` in the same file, so there is one push implementation. `pushStoredNotification` never throws; on failure it logs `notifications.push.failed` at warn with the error name and code only. `contracts` (layer 6) imports `notifications` (layer 5) through `index.ts`.
- Contracts calls the push after the commit, outside the transaction and with no lock held, and only when `insertNotification` returned a row (null means the row existed). The push sits where `sendNotification` sat, so the order against `emitConversationUpdate` is unchanged, and the failure semantics of the emits are unchanged. A failed push never fails the request.
- With RabbitMQ disabled the row is still written and pushed.
- The push is folded into this batch, so sub-batch 4 is documentation only.
- The consumer path is unchanged (store, ack, then push); the cancel notice (ADR 0023) is still on the old path.
