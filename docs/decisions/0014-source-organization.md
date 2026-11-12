# 0014: API source organization

Status: accepted.

This extends ADR 0013. It supersedes ADR 0013 section 1 on four points: `schema.ts` being one file, the contents of `shared/`, the layout of `test/`, and where app-wide middleware lives. Dependency direction, table ownership, third-party clients and the boundary test (ADR 0013 sections 2 to 4 and 6) are unchanged. ADRs 0004 to 0013 are not rewritten; the superseded lines in ADR 0013 are marked in place.

## Context

Stage 10 fixed the direction of dependencies. The inside of the folders is the remaining problem, measured on `services/api/src`:

- `shared/http` holds 24 files. Only 4 middlewares (`not-found`, `error`, `http-logger`, `request-id`) are used by `app.ts` alone; the rest split into an auth group and a limits group.
- `shared/utils` holds 6 source files of 4 unrelated concerns plus `agency-identity.ts`, a database query with one caller (`freelancer.service.ts`).
- `test/` mixes global test setup with helpers imported by 30 test files.
- `contracts.service.ts` (1700 lines, 69 db calls, functions of 153 to 265 lines) and `agency.service.ts` (1717 lines, 52 db calls) are the only services where queries and rules are hard to separate. The other services have 3 to 34 db calls and 8 or fewer files per module.
- `schema.ts` is 1283 lines and 28 tables.

## Decision

### 1. Module shape rule

A module is flat (`route`, `controller`, `schemas`, `responses`, `types`, `public`, `errors`, `repository`, `service`, tests) unless a threshold is met:

| Addition                   | Threshold                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `tests/` folder            | 10 or more files in the module and 4 or more test files                             |
| `services/` folder         | a service over 800 lines with 4 or more use-case groups                             |
| `<module>.repository.ts`   | a service over 1000 lines, more than 40 db calls, and repeated query shapes         |
| extracted constant or type | used by 2 or more files, a magic value, or more than about 15 lines of declarations |

Zod-inferred types stay in `*.schemas.ts`. Small modules (auth, identity, notifications, client, connects, payouts, proposals) stay flat. Subfolders inside a module are invisible to the boundary test, which reads only the first segment after `modules/`; the public surface stays `modules/<name>/<name>.public.ts`.

### 2. `app-middleware/` and `shared/`

- `src/app-middleware/`: middleware composed only by `app.ts` (`error`, `http-logger`, `not-found`, `request-id`). It is an infrastructure-level directory: it cannot import modules.
- `shared/http/`: `api-error`, `async-handler`, `validate.middleware`; `auth/` (`auth.middleware`, `admin-session.middleware`, `role-guards`); `limits/` (`json-body`, `rate-limit`, `user-rate-limit`). `auth.middleware` stays in `shared/http/auth`: it cuts across every module and only reads `accounts`.
- `shared/logging/` (`sanitize-log`), `shared/uploads/` (`attachments`, `portfolio-images`), `shared/ids/` (`uuid-v5`), `shared/validation/` (adds `email`), `shared/money/` unchanged. `shared/utils/` is removed.
- `agency-identity` moves into `modules/freelancer` as `freelancer.agency-identity.ts`, its only user. It reads `agency_members` and `agency_metadata`, tables owned by agency. ADR 0013 section 4 allows reads of tables a module does not own but did not list this one; it is recorded here as a read-only cross-module access, and the boundary test needs no exception because it imports only `database`.

### 3. Schema split

`src/database/schema.ts` stays as a file that re-exports `src/database/schema/<domain>.ts` files (enums and accounts at the bottom of the import direction, other domains import downward). `drizzle.config.ts` and every importer stay unchanged. Gate: `drizzle-kit generate` prints "No schema changes" and no file appears under `drizzle/`. Where the table definitions live is superseded by section 9. This supersedes ADR 0013 section 1 on `schema.ts` staying one file.

### 4. Test layout and suffix vocabulary

`src/test/setup/` holds global setup (`setup.ts`, `assert-test-database.ts` and its test). `src/test/support/` holds helpers (`capture-logs`, `factories`, `fake-secrets`, `lock-holder`). `src/test/architecture/` is unchanged.

| Suffix                           | Meaning                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `<subject>[.<topic>].test.ts`    | unit test, mocks allowed, no real Postgres                            |
| `.validation.test.ts`            | HTTP 4xx through supertest, database mocked                           |
| `.contract.test.ts`              | real Postgres, 2xx bodies parsed with the response schemas            |
| `[.<topic>].integration.test.ts` | real Postgres, Redis or RabbitMQ behaviour: races, permissions, locks |

`<subject>` is the base name of the source file under test. Tests are renamed and moved, never merged: files carry different `vi.mock` sets, which are hoisted per file. A database-free run is possible after the renames with `vitest --exclude "**/*.{contract,integration}.test.ts"`; it is not a gate, because `setup.ts` still requires local database URLs.

### 5. Selective repositories

A repository is a file of plain functions taking a db-or-transaction executor as the first argument. No classes, no interfaces, no base class. It owns queries only. Services own transactions and business rules; lock-first `FOR UPDATE` (ADR 0005) and guarded conditional `UPDATE`s (ADR 0007) stay visible in the service. Adopted for `contracts` and `agency`. Deferred until the contracts diff is measured: `freelancer`, `messaging`, `proposals`. Skipped: every other module, where a repository would only pass calls through; `payouts.state.ts` already plays this role for payouts.

### 6. Pattern decisions

| Pattern                      | Decision                                                  | Reason and scope                                                                                                               |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Modular Monolith             | keep                                                      | ADR 0001 and 0013, enforced by the boundary test                                                                               |
| Feature-oriented             | keep                                                      | one folder per domain module                                                                                                   |
| Vertical Slice               | reject                                                    | per-endpoint folders would break the per-module schemas, responses and registries; use-case split only in contracts and agency |
| Selective Clean Architecture | reject                                                    | ports would each have one implementation; only the existing rule that third-party clients live in `infrastructure/` stays      |
| Pragmatic DDD                | keep what exists                                          | modules are bounded contexts with table ownership; no entities, aggregates or value objects                                    |
| DI and composition root      | reject the container                                      | `bootstrap/` and `app.ts` already compose the app; tests use `vi.mock`                                                         |
| Repository and service layer | service layer exists; repository for contracts and agency | evidence in section 5                                                                                                          |
| Adapter                      | keep                                                      | `infrastructure/*`                                                                                                             |
| Strategy                     | reject                                                    | no family of algorithms chosen at runtime; agency roles are data                                                               |
| Factory                      | keep existing, add none                                   | `createHttpLogger`, `test/support/factories`                                                                                   |
| Facade                       | keep                                                      | `<name>.public.ts`                                                                                                             |
| Observer or pub-sub          | keep                                                      | RabbitMQ (ADR 0004), socket.io, SSE                                                                                            |
| Outbox                       | defer                                                     | RabbitMQ is optional by design; revisit when the broker becomes required                                                       |
| Idempotent consumer          | keep                                                      | `notifications.consumer.ts` inserts with `onConflictDoNothing` on `event_id`                                                   |
| Retry                        | keep                                                      | consumer backoff and payout attempts; no generic retry helper                                                                  |
| Circuit breaker              | reject                                                    | needs new state or a dependency and nothing shows cascading failures; timeouts come first                                      |

### 7. Delivery semantics

The notifications consumer is exactly-once for the database write (redelivery inserts nothing). It acknowledges the message before the SSE push, so the push is at-most-once: a crash between the ack and the push loses the push, and the notification is still readable from the database. This is accepted. The consumer's failure counter is in memory and resets on restart. Outbox is deferred for the reason above.

### 8. Behaviour preservation

Every stage that applies this ADR keeps `docs/api/openapi.json` byte-identical, the full suite at 0 failed and 0 skipped with per-file test counts unchanged, `boundary-exceptions.ts` empty, no cycles, "No schema changes" from drizzle-kit, and no migration files. Docs, vitest and eslint globs, the CI junit path and agent or command files that name paths are updated in the same stage as the move.

### 9. Table files and table access

Decided, to be executed in stages; a rule is in place only once its stage has run. Status: table placement is executed. The table definitions live in `modules/<name>/<name>.schema.ts`, `database/schema.ts` is a temporary barrel that re-exports them under one named temporary rule in the boundary test, and `database/schema/` is deleted. Consumers and `drizzle.config.ts` follow in the next stage, which also removes the barrel and its rule. Table definitions (drizzle tables, enums and relations) will move into their owning module as `modules/<name>/<name>.schema.ts`. This is a different file from `<name>.schemas.ts`, which holds the zod request and response schemas; tooling that targets table files matches the exact suffix `.schema.ts`. `accounts` and `accountRole` belong to auth. The central `database/schema/` folder from section 3 is an intermediate step and is deleted at the end of the move.

Stage 0 adds only a safety net, with no file moves: `table-ownership.ts` maps every table and enum to its owner, `table-access-allowlist.ts` lists every cross-module table access (read or write) with a reason on each write, and `table-access.test.ts` fails on an unlisted access and on a stale entry. It supersedes the prose list in ADR 0013 section 4. The test is keyed on table names and owners, not file paths, so it covers the central folder now and the `.schema.ts` files later.

## Consequences

- Moves are mechanical and reviewable per stage; no behaviour changes.
- `app-middleware` is added to the infrastructure directories of the boundary test when the folder is created.
- Splitting `schema.ts` and removing `shared/utils` change import paths in many files; the typecheck and the boundary test are the safety net.
- Findings outside the layout (Daily request timeout, `getAccountContracts` batching of Clerk lookups, whether RabbitMQ publishes happen inside or after the commit) are separate stages.
