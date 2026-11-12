# Test plan: Stage 5d guarded state transitions

## Scope

- `services/api/src/modules/contracts/contracts.service.ts`: `submitContractMilestone`, `acceptContract`, `addContractMilestone`, `finishContractWithReview` (design: `docs/decisions/0007-guarded-state-transitions.md`).
- `services/api/src/modules/meetings/meetings.service.ts`: `startMeeting` with the partial unique index `meetings_one_active_per_conversation_unique` (migration `drizzle/0003_brave_legion.sql`).
- `services/api/src/shared/http/api-error.ts` and `src/shared/http/error.middleware.ts`: optional `code` in 4xx bodies.

Use only the `_test` database and mocked Stripe/Daily. Never use or print the real `.env`.

## How to run

Docker Postgres must be up and the `_test` database must have migration `0003` (`pnpm --filter @onemarketplace/api db:test:migrate`, or `db:test:setup`).

```
pnpm --filter @onemarketplace/api test:quiet src/modules/contracts src/modules/meetings
```

## Race technique

`src/test/lock-holder.ts` opens a transaction that holds `SELECT ... FOR UPDATE` on one row (`holdRowLock`), starts the competing calls, and waits until `pg_stat_activity` shows them in a lock wait whose `pg_blocking_pids` lead to the holder (`waitForBlocked`, polling, no fixed sleeps). It then rolls the holder back and the calls proceed in a known state. `raceBlocked` with `ordered: true` starts them one at a time so the queue order is fixed.

## Automated coverage

Files: `contracts.state-transitions.integration.test.ts` (S) and `meetings.start.integration.test.ts` (M).

| Transition              | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accept offer            | S "acceptContract races > lets exactly one of two accepts blocked on the contract row win and counts once"; "answers CONTRACT_OFFER_NOT_ACCEPTABLE and rolls back when the first milestone is no longer pending"                                                                                                                                                                                                                                                                                                                          |
| Submit milestone        | S "submitContractMilestone races > keeps invariants for two submits blocked on the milestone row"; "rejects a submit queued behind an approval and leaves the completed milestone untouched"; "lets an approval queued behind a resubmit succeed on the same milestone"; "never records a submission on a completed milestone in an unordered submit and approve race"                                                                                                                                                                    |
| Add milestone           | S "addContractMilestone races > lets exactly one of two adds blocked on the contract row win"; "rejects an add queued behind a finish and leaves no milestone on the completed contract"; "rejects a finish queued behind an add because the new milestone is incomplete"; "serializes an add behind a finish that already read its milestone check (...)"; "keeps invariants when an approval and an add race without a holder"; "rejects an add that reads the milestone while its approval is still uncommitted, then allows it after" |
| Finish contract         | S "finishContractWithReview races > lets the %s finish first and rejects the %s queued behind it with CONTRACT_ALREADY_FINISHED" (client then freelancer, freelancer then client); "answers the second parallel finish by the same reviewer with a coded 409 on an active contract"; "answers REVIEW_ALREADY_SUBMITTED, not a 500, for the same reviewer twice in parallel on a completed contract"                                                                                                                                       |
| Approval against finish | S "reviewContractMilestone against contract transitions > rejects a finish that runs while the last approval is uncommitted, then finishes after it"; "never completes the contract with an incomplete milestone in an unordered approval and finish race"                                                                                                                                                                                                                                                                                |
| startMeeting            | M "startMeeting against real Postgres > returns the committed holder meeting to two racing starts without a message or emit"; "lets exactly one blocked start win after the holder rolls back"; "emits only after commit and exactly once for the winner"; "removes the meeting, propagates the error, names the orphan room and does not emit when the message insert fails"; "succeeds and logs emit_failed when the post-commit emit fails"; "returns the existing active meeting without creating a Daily room"                       |

## Mutation check

Each guard was removed or weakened in turn, the suite run, and the file restored (sha256 verified byte-identical afterward).

| #   | Mutation                                                     | Result                                                                                                                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | submit: predicates removed                                   | KILLED                                                                                                                   |
| 2   | submit: rows check removed                                   | KILLED                                                                                                                   |
| 3a  | accept: milestone predicates removed                         | KILLED                                                                                                                   |
| 3b  | accept: milestone rows check removed                         | KILLED                                                                                                                   |
| 4a  | accept: contract-row `PENDING` predicate removed             | SURVIVED, equivalent: redundant with the milestone-0 guard in the same transaction; a concurrent accept rolls back there |
| 4b  | accept: contract-row rows check removed                      | SURVIVED, equivalent, same reason                                                                                        |
| 5   | add: `FOR UPDATE` removed                                    | KILLED (4 tests)                                                                                                         |
| 6   | finish: `FOR UPDATE` removed                                 | KILLED (6 tests)                                                                                                         |
| 7   | add: incomplete-count check removed                          | KILLED                                                                                                                   |
| 8   | finish: incomplete-count check removed                       | KILLED                                                                                                                   |
| 9a  | finish: final `UPDATE` `status = 'ACTIVE'` predicate removed | SURVIVED, equivalent: defensive duplicate behind the lock and the locked-status check                                    |
| 9b  | finish: `CONTRACT_ALREADY_FINISHED` after-lock check removed | KILLED                                                                                                                   |
| 9c  | finish: final rows check removed                             | SURVIVED, equivalent, same as 9a                                                                                         |
| 10  | finish: `23505` mapping removed                              | KILLED                                                                                                                   |
| 11  | startMeeting: `23505` handling removed                       | KILLED (2 tests)                                                                                                         |

Not run: dropping the partial unique index (needs a DB change; the index is exercised by the two meetings race tests) and making `startMeeting` non-transactional.

## Not covered

- Agency double review by two teammates (ADR 0007, item a).
- HIRED status, decline and withdraw (no such transitions), proposal past INTERVIEWED.
- Double-paid checkouts: the second webhook is ignored, the double charge is not tested.
- Daily room cleanup after a lost `startMeeting` race (only logged as `task.meeting.room_orphaned`).
- Real Daily and Stripe, several API processes, more than three parallel requests.
- Frontend behavior on the new 409 codes (no app calls the API yet).

## Stage 6b: invitation accept and createAgency (M9, ADR 0008)

Test file: `modules/agency/agency.team.integration.test.ts` (real `_test` database, same race technique as above).

| Scenario                                                                                           | Type               | Expected                                                          | Status                          |
| -------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- | ------------------------------- |
| Accept a PENDING invitation                                                                        | integration        | 200, member row inserted, status ACCEPTED                         | covered                         |
| Accept or decline twice, or accept after cancel or decline                                         | integration        | second call 409 `INVITATION_ALREADY_HANDLED`, one member row      | covered                         |
| Two parallel accepts of the same invitation                                                        | integration (race) | one 200, one 409, one member row                                  | covered                         |
| Accept while the invitee already has a membership (23505 on `agency_members_freelancer_id_unique`) | integration        | 409 `ALREADY_IN_AGENCY`, invitation status rolled back to PENDING | covered                         |
| `createAgency` when already a member or owner                                                      | integration        | 409 `ALREADY_IN_AGENCY`                                           | covered                         |
| `createAgency` lost race on the owner constraint (23505 on `agency_metadata_owner_id_unique`)      | integration (race) | one 201, one 409 `ALREADY_IN_AGENCY`, never 500                   | covered                         |
| `createAgency` lost race on the member constraint                                                  | integration (race) | same 409                                                          | covered                         |
| Resend within 60 s (guarded `UPDATE` on `updated_at`)                                              | integration        | 429 `INVITATION_RESEND_COOLDOWN`                                  | covered                         |
| Two simultaneous identical invites                                                                 | integration        | both can succeed (no unique pending index)                        | not covered, needs `/db-change` |

### Mutation checks (Stage 6b)

| Mutation                                                                                        | Result                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| H1 cover image and avatar accept `imageId` or arbitrary url, freelancer and agency (4 variants) | caught                                                           |
| M1 `isAuthenticated` no longer 403 without an account                                           | caught                                                           |
| M1 socket handshake accepts a missing account                                                   | caught                                                           |
| M9 accept guard (`WHERE status = 'PENDING'`) removed                                            | caught                                                           |
| M9 `createAgency` 23505 owner mapping removed                                                   | caught                                                           |
| M9 `createAgency` 23505 member mapping removed                                                  | caught                                                           |
| M9 accept 23505 mapping removed                                                                 | caught                                                           |
| M10 `submitProposal` self-dealing check removed                                                 | caught                                                           |
| M10 `submitAgencyProposal` team check removed                                                   | caught                                                           |
| M10 `createConversation` direct self recipient check removed                                    | caught                                                           |
| M10 `createConversation` proposal freelancer counterpart check removed                          | caught                                                           |
| M10 `createConversation` proposal agency counterpart check removed                              | caught                                                           |
| M9 `createAgency` sequential pre-check removed alone                                            | equivalent mutant: same 409 through the 23505 mapping, not a gap |

`resolveAccountRole` 403 was already covered by an existing test in `large-body-auth.test.ts`, so it needed no new mutation.
