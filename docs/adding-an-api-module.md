# Adding an API module or route

On-demand checklist for `services/api`. Rules and rationale: `services/api/AGENTS.md` and `docs/decisions/0013-api-source-layout-and-import-boundaries.md`. Paths are relative to `services/api/src`. Import across directories with `@/modules/...` and the like, siblings with `./` (ADR 0020).

## New module

Every module follows the folder layout of ADR 0016 (`docs/decisions/0016-module-folder-layout.md`); `src/test/architecture/module-layout.test.ts` fails on any other shape.

1. Create `modules/<name>/` (kebab-case) with `<name>.route.ts` at the root and, only for the folders that hold files: `controllers/<name>.controller.ts`, `services/<name>.service.ts`, `repositories/<name>.repository.ts`, `schemas/<name>.schema.ts` (zod request schemas), `responses/<name>.responses.ts`, `types/<name>.types.ts`, `utils/` for helpers, and `models/<name>.model.ts` when the module owns tables (drizzle tables and enums; the drizzle glob `src/modules/*/models/*.model.ts` picks it up with no config change). Add each new table or enum to `table-ownership.ts` and `src/test/support/tables.ts`. Middleware goes in `middleware/<name>.middleware.ts`; the `.cron`, `.socket` and `.consumer` entry points stay at the module root and `.sse.ts` goes in `services/`. Tests go in `tests/`.
2. Mount the router in `routes/index.ts`. Routes that must combine two modules are wired in `routes/`, not by one module importing another's controller.
3. Add the module to `moduleLayers` in `test/architecture/import-boundaries.test.ts`, and to the layer table in ADR 0013 in the same PR. A module may import only a strictly lower layer. Never add an entry to `test/architecture/boundary-exceptions.ts`.
4. Create `index.ts` only when another module needs something from this one (today `agency`, `auth`, `connects`, `freelancer`, `health`, `jobs`, `messaging`, `payouts`, `proposals`). Export the minimum, as plain re-exports of functions.

## New route

1. Request schemas in `schemas/<name>.schema.ts` (strict objects, limits from the module's `constants/<name>.constants.ts` (`shared/validation/constants/` only when several modules share a limit), `uuidParam` from `shared/validation/schemas/common.schema.ts`). Define the route's `{ params, query, body } satisfies RequestSchemas` object once as `<route>Request` in the same file, spread it into `validate({ ...<route>Request, responses })` (from `middleware/validate/validate.middleware.ts`, after authentication and role guards in `middleware/auth/role-guards.middleware.ts`) and read it in the controller with `getValidated(request, <route>Request)`; never `request.body|params|query` (`controller-input.test.ts`).
2. Response schemas in `responses/<name>.responses.ts` with a 2xx entry; shared pieces in `shared/responses/api-envelope.responses.ts`.
3. Add a contract test (`tests/<name>.contract.test.ts`) that parses real responses with those schemas, and a validation test (`tests/<name>.validation.test.ts`).
4. Only raw-body webhooks and event streams may use `src/test/architecture/routing/validation-allowlist.ts` and `src/openapi/introspection/contract-allowlist.ts`, each with a written reason.
5. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`.
6. Services and repositories: for several use cases, split services as `modules/contracts/` does: `services/<name>.<use-case>.service.ts` files with no barrel (the controller imports each file) and a leaf `utils/<name>.helpers.ts` only if several use cases share code that imports no sibling service. Put SQL in `repositories/<name>.repository.ts` (ADR 0015): plain functions with a `DbExecutor` first parameter for repeated or long unguarded queries; `FOR UPDATE` locks and state-guarded updates and inserts move into repository functions whose names encode the lock or guard (ADR 0015 section 4), while transaction boundaries, call order and the interpretation of results (404s, 409s) stay in the service, which passes its transaction handle. When another module must write your tables inside its transaction, expose an executor-first function in `index.ts` (ADR 0014 section 11) instead of listing a write in the allowlist.
7. Authorization and object ownership are enforced in the service, not only the route.

## Rules that apply to both

Money in cents, SQL in repositories, table ownership, third-party clients only in `infrastructure/`, schema changes through `/db-change` and the error shape are in `services/api/AGENTS.md` (rules) and `docs/architecture.md` (structure); they are not repeated here. Module-specific points:

- Events: publish through `infrastructure/events`. Consumers live in the module that owns the data they write. RabbitMQ stays optional.
- Register new tables in `table-ownership.ts`; an edge to another module's table is a read in `table-access-allowlist.ts` or an owner function in that module's `index.ts` (ADR 0014 section 11).

## Tests

- Unit tests next to the file (`*.test.ts`); contract tests parse real responses; integration tests (`*.integration.test.ts`) run against the `_test` database (`pnpm --filter @onemarketplace/api db:test:setup`).
- Mock Stripe, Clerk, Daily and ImageKit; never call them for real.

## Gates before finishing

- `pnpm check` and `pnpm -r build`
- `pnpm --filter @onemarketplace/api test` (full vitest, includes the architecture test; scoped: `test:quiet <path>`)
- `pnpm --filter @onemarketplace/api openapi:generate`, then `git diff --exit-code docs/api/openapi.json`
- `pnpm --filter @onemarketplace/api db:generate` reports "No schema changes"
