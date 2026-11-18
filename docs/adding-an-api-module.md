# Adding an API module or route

On-demand checklist for `services/api`. Rules and rationale: `services/api/AGENTS.md` and `docs/decisions/0013-api-source-layout-and-import-boundaries.md`. Paths are relative to `services/api/src`.

## New module

Every module follows the folder layout of ADR 0016 (`docs/decisions/0016-module-folder-layout.md`); `src/test/architecture/module-layout.test.ts` fails on any other shape.

1. Create `modules/<name>/` (kebab-case) with `<name>.route.ts` at the root and, only for the folders that hold files: `controllers/<name>.controller.ts`, `services/<name>.service.ts`, `repositories/<name>.repository.ts`, `schemas/<name>.schema.ts` (zod request schemas), `responses/<name>.responses.ts`, `types/<name>.types.ts`, `utils/` for helpers, and `models/<name>.model.ts` when the module owns tables (drizzle tables and enums; the drizzle glob `src/modules/*/models/*.model.ts` picks it up with no config change). Add each new table or enum to `table-ownership.ts` and `src/test/support/tables.ts`. Middleware goes in `middleware/<name>.middleware.ts`; the `.cron`, `.socket` and `.consumer` entry points stay at the module root and `.sse.ts` goes in `services/`. Tests go in `tests/`.
2. Mount the router in `routes/index.ts`. Routes that must combine two modules are wired in `routes/`, not by one module importing another's controller.
3. Add the module to `moduleLayers` in `test/architecture/import-boundaries.test.ts`, and to the layer table in ADR 0013 in the same PR. A module may import only a strictly lower layer. Never add an entry to `test/architecture/boundary-exceptions.ts`.
4. Create `index.ts` only when another module needs something from this one (today `agency`, `auth`, `connects`, `freelancer`, `health`, `jobs`, `messaging`, `proposals`). Export the minimum, as plain re-exports of functions.

## New route

1. Request schemas in `schemas/<name>.schema.ts` (strict objects, limits from the module's `constants/<name>.constants.ts` (`shared/validation/constants/` only when several modules share a limit), `uuidParam` from `shared/validation/schemas/common.schema.ts`). Apply `validate({ params, query, body, responses })` from `middleware/validate/validate.middleware.ts` after authentication and role guards (`middleware/auth/role-guards.middleware.ts`).
2. Response schemas in `responses/<name>.responses.ts` with a 2xx entry; shared pieces in `shared/responses/api-envelope.responses.ts`.
3. Add a contract test (`tests/<name>.contract.test.ts`) that parses real responses with those schemas, and a validation test (`tests/<name>.validation.test.ts`).
4. Only raw-body webhooks and event streams may use `src/test/architecture/routing/validation-allowlist.ts` and `src/openapi/introspection/contract-allowlist.ts`, each with a written reason.
5. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`.
6. Services and repositories: for several use cases, split services as `modules/contracts/` does: `services/<name>.<use-case>.service.ts` files with no barrel (the controller imports each file) and a leaf `utils/<name>.helpers.ts` only if several use cases share code that imports no sibling service. Put SQL in `repositories/<name>.repository.ts` (ADR 0015): plain functions with a `DbExecutor` first parameter for repeated or long unguarded queries; `FOR UPDATE` locks and state-guarded updates and inserts move into repository functions whose names encode the lock or guard (ADR 0015 section 4), while transaction boundaries, call order and the interpretation of results (404s, 409s) stay in the service, which passes its transaction handle. When another module must write your tables inside its transaction, expose an executor-first function in `index.ts` (ADR 0014 section 11) instead of listing a write in the allowlist.
7. Authorization and object ownership are enforced in the service, not only the route.

## Rules that apply to both

- Money is integer cents: `*_cents` columns, `*Cents` fields, helpers from `shared/money/money.ts`.
- SQL: put queries in `repositories/<name>.repository.ts` (plain functions, executor first); a service opens `db.transaction` and passes the handle down but never queries, and `index.ts` only re-exports (ADR 0015). There is no exemption list: a file that holds SQL outside a repository fails `repository-sql.test.ts`, and a repository that throws or imports `ApiError` fails `repository-purity.test.ts`; return the result and let the service throw.
- Tables: touch another module's tables only to read, through an edge in `services/api/src/test/architecture/table-access-allowlist.ts`. A write to another module's table is an owner function in the owner's `index.ts` (executor first, SQL only, ADR 0014 section 11); the allowlist holds no writes and a test fails if one is added. New edges need review. Register new tables in `table-ownership.ts`. `models/<name>.model.ts` (drizzle tables) is different from `schemas/<name>.schema.ts` (zod).
- Events: publish through `infrastructure/events`. Consumers live in the module that owns the data they write. RabbitMQ stays optional.
- Third-party clients (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) exist only in `infrastructure/`; modules import them from there. Config comes from `config/`.
- Schema changes go only through `/db-change`; never edit `database/` or `drizzle/` by hand.
- Errors are `{ success: false, message, code, requestId, errors? }`; log with pino, never `console.*`.

## Tests

- Unit tests next to the file (`*.test.ts`); contract tests parse real responses; integration tests (`*.integration.test.ts`) run against the `_test` database (`pnpm --filter @onemarketplace/api db:test:setup`).
- Mock Stripe, Clerk, Daily and ImageKit; never call them for real.

## Gates before finishing

- `pnpm check` and `pnpm -r build`
- `pnpm --filter @onemarketplace/api test` (full vitest, includes the architecture test; scoped: `test:quiet <path>`)
- `pnpm --filter @onemarketplace/api openapi:generate`, then `git diff --exit-code docs/api/openapi.json`
- `pnpm --filter @onemarketplace/api db:generate` reports "No schema changes"
