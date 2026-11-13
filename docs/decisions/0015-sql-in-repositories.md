# 0015: SQL lives in repositories

Status: accepted. Amends ADR 0014 section 5.

## Context

ADR 0014 section 5 adopted repositories only for `contracts` and `agency` and kept every `FOR UPDATE` lock and guarded `UPDATE` in the service. Cross-module writes now go through owner functions (ADR 0014 section 11), but those functions, and the SQL of every other module, still sit in services and `.public.ts` files. At the start of this decision 27 non-test files outside `database/` and `bootstrap/` build queries: 264 calls to `select`, `insert`, `update`, `delete` or `execute` on `db`, a transaction handle or an executor. A rule that only some modules follow cannot be enforced.

## Decision

1. **Uniform rule.** Every module's SQL lives in `<module>.repository.ts` files. A `.public.ts` only re-exports repository functions or service functions that contain no SQL (`export { x } from "./<name>.repository.js"`). Carve-outs: `database/`, `bootstrap/`, test files, `*.schema.ts` and `*.repository.ts` themselves.
2. **What services may do.** A service may import `db` only to open `db.transaction` and pass the handle down. It may not import `drizzle-orm` query helpers or any `*.schema.ts`, and may not call `select`, `insert`, `update`, `delete` or `execute` on `db`, a transaction handle or an executor.
3. **Repository shape.** Plain functions with a `DbExecutor` as the first parameter, no classes. A repository splits by use case once it passes about 400 lines (`agency.invitations.repository.ts`); the `*.repository.ts` glob covers the split files.
4. **Locks and guards move.** `FOR UPDATE` locks and guarded conditional `UPDATE`s (ADR 0005, ADR 0007) move into repository functions whose names encode the lock or guard (`lockContractForUpdate`, `markMilestoneFundedIfPending`). They return rows or affected counts and carry no business decision and no `ApiError`. Services keep transaction boundaries, ordering and the interpretation of results. Every moved lock or guard has a test that fails when the lock or guard is removed, proven by mutation in the stage that moves it. The cost is that a state machine in a service reads as a sequence of named calls; the names carry the guard.
5. **`auth.middleware.ts`.** `shared/http/auth/auth.middleware.ts` stays on the exemption list until the closing stage, then moves into `modules/auth` and is exposed through `auth.public.ts`.
6. **`writeSystemEventMessage`.** In the messaging stage it is rebuilt on `appendConversationMessages`, which gains two unread targets, `{ exceptParticipant }` and `{ all }`. A wrapper keeps the empty-insert `ApiError(500, "Event message could not be created.")` and the single-row return. The unread mutations are re-run for every target.

## Enforcement and ratchet

`src/test/architecture/repository-sql.test.ts` parses every source file with the TypeScript parser and fails when a file outside the carve-outs imports `drizzle-orm` (type-only imports are fine) or a `*.schema.ts`, or calls a query method on `db`, a transaction handle or an executor. Files that still break the rule are listed in `repository-sql-exemptions.ts`. A new violation fails, and an exempt file that is already clean fails as stale, so the list only shrinks. Modules are converted stage by stage and the exemption list is the progress tracker; the closing stage deletes it. The table-ownership and table-access tests and their allowlist are separate and unchanged.

## Consequences

- Every conversion stage moves one module's SQL, keeps behavior identical, and removes that module's files from the exemption list.
- Guards and locks are reviewed in repositories, with mutation proof, instead of inline in services.
- ADR 0014 section 5 points here; this ADR wins where they differ.
