# Adding an API module or route

On-demand checklist for `services/api`. Rules and rationale: `services/api/AGENTS.md` and `docs/decisions/0013-api-source-layout-and-import-boundaries.md`. Paths are relative to `services/api/src`.

## New module

1. Create `modules/<name>/` (kebab-case) with role-suffixed files: `<name>.route.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.schemas.ts`, `<name>.responses.ts`, `<name>.types.ts` when needed, and `<name>.schema.ts` when the module owns tables (drizzle tables and enums; the drizzle glob `src/modules/*/*.schema.ts` picks it up with no config change; zod stays in `<name>.schemas.ts`). Add each new table or enum to `table-ownership.ts` and `src/test/support/tables.ts`. Use `.middleware`, `.cron`, `.socket` or `.sse` suffixes for those roles.
2. Mount the router in `routes/index.ts`. Routes that must combine two modules are wired in `routes/`, not by one module importing another's controller.
3. Add the module to `moduleLayers` in `test/architecture/import-boundaries.test.ts`, and to the layer table in ADR 0013 in the same PR. A module may import only a strictly lower layer. Never add an entry to `test/architecture/boundary-exceptions.ts`.
4. Create `<name>.public.ts` only when another module needs something from this one (today `agency`, `auth`, `connects`, `freelancer`, `jobs`, `messaging`). Export the minimum, as plain re-exports of functions.

## New route

1. Request schemas in `<name>.schemas.ts` (strict objects, limits from `shared/validation/validation-limits.ts`, `uuidParam` from `shared/validation/common-schemas.ts`). Apply `validate({ params, query, body, responses })` from `shared/http/validate.middleware.ts` after authentication and role guards (`shared/http/role-guards.ts`).
2. Response schemas in `<name>.responses.ts` with a 2xx entry; shared pieces in `shared/validation/response-schemas.ts`.
3. Add a contract test (`<name>.contract.test.ts`) that parses real responses with those schemas, and a validation test (`<name>.validation.test.ts`).
4. Only raw-body webhooks and event streams may use `routes/validation-allowlist.ts` and `routes/contract-allowlist.ts`, each with a written reason.
5. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`.
6. Only when ADR 0014 thresholds are met, split the module as `modules/contracts/` does: `services/<name>.<use-case>.service.ts` files with no barrel (the controller imports each file), a leaf `<name>.helpers.ts` only if several use cases share code that imports no sibling service, and tests in `tests/`. Add `<name>.repository.ts` only past the ADR 0014 repository threshold: plain functions with a `DbExecutor` first parameter for repeated or long unguarded queries; `FOR UPDATE` locks and state-guarded updates and inserts move into repository functions whose names encode the lock or guard (ADR 0015 section 4), while transaction boundaries, call order and the interpretation of results (404s, 409s) stay in the service, which passes its transaction handle. When another module must write your tables inside its transaction, expose an executor-first function in `<name>.public.ts` (ADR 0014 section 11) instead of listing a write in the allowlist. Otherwise stay flat.
7. Authorization and object ownership are enforced in the service, not only the route.

## Rules that apply to both

- Money is integer cents: `*_cents` columns, `*Cents` fields, helpers from `shared/money/money.ts`.
- SQL: put queries in `<name>.repository.ts` (plain functions, executor first); a service opens `db.transaction` and passes the handle down but never queries, and `.public.ts` only re-exports (ADR 0015). There is no exemption list: a file that holds SQL outside a repository fails `repository-sql.test.ts`, and a repository that throws or imports `ApiError` fails `repository-purity.test.ts`; return the result and let the service throw.
- Tables: touch another module's tables only to read, through an edge in `services/api/src/test/architecture/table-access-allowlist.ts`. A write to another module's table is an owner function in the owner's `<name>.public.ts` (executor first, SQL only, ADR 0014 section 11); the allowlist holds no writes and a test fails if one is added. New edges need review. Register new tables in `table-ownership.ts`. `<name>.schema.ts` (drizzle tables, planned) is different from `<name>.schemas.ts` (zod).
- Events: publish through `infrastructure/events`. Consumers live in the module that owns the data they write. RabbitMQ stays optional.
- Third-party clients (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) exist only in `infrastructure/`; modules import them from there. Config comes from `config/`.
- Schema changes go only through `/db-change`; never edit `database/` or `drizzle/` by hand.
- Errors are `{ success: false, message }`; log with pino, never `console.*`.

## Tests

- Unit tests next to the file (`*.test.ts`); contract tests parse real responses; integration tests (`*.integration.test.ts`) run against the `_test` database (`pnpm --filter @onemarketplace/api db:test:setup`).
- Mock Stripe, Clerk, Daily and ImageKit; never call them for real.

## Gates before finishing

- `pnpm check` and `pnpm -r build`
- `pnpm --filter @onemarketplace/api test` (full vitest, includes the architecture test; scoped: `test:quiet <path>`)
- `pnpm --filter @onemarketplace/api openapi:generate`, then `git diff --exit-code docs/api/openapi.json`
- `pnpm --filter @onemarketplace/api db:generate` reports "No schema changes"
