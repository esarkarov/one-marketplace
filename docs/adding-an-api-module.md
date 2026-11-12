# Adding an API module or route

On-demand checklist for `services/api`. Rules and rationale: `services/api/AGENTS.md` and `docs/decisions/0013-api-source-layout-and-import-boundaries.md`. Paths are relative to `services/api/src`.

## New module

1. Create `modules/<name>/` (kebab-case) with role-suffixed files: `<name>.route.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.schemas.ts`, `<name>.responses.ts`, and `<name>.types.ts` when needed. Use `.middleware`, `.cron`, `.socket` or `.sse` suffixes for those roles.
2. Mount the router in `routes/index.ts`. Routes that must combine two modules are wired in `routes/`, not by one module importing another's controller.
3. Add the module to `moduleLayers` in `test/architecture/import-boundaries.test.ts`, and to the layer table in ADR 0013 in the same PR. A module may import only a strictly lower layer. Never add an entry to `test/architecture/boundary-exceptions.ts`.
4. Create `<name>.public.ts` only when another module needs something from this one (today `agency`, `connects`, `freelancer`, `messaging`). Export the minimum, as plain re-exports of functions.

## New route

1. Request schemas in `<name>.schemas.ts` (strict objects, limits from `shared/validation/validation-limits.ts`, `uuidParam` from `shared/validation/common-schemas.ts`). Apply `validate({ params, query, body, responses })` from `shared/http/validate.middleware.ts` after authentication and role guards (`shared/http/role-guards.ts`).
2. Response schemas in `<name>.responses.ts` with a 2xx entry; shared pieces in `shared/validation/response-schemas.ts`.
3. Add a contract test (`<name>.contract.test.ts`) that parses real responses with those schemas, and a validation test (`<name>.validation.test.ts`).
4. Only raw-body webhooks and event streams may use `routes/validation-allowlist.ts` and `routes/contract-allowlist.ts`, each with a written reason.
5. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`.
6. Authorization and object ownership are enforced in the service, not only the route.

## Rules that apply to both

- Money is integer cents: `*_cents` columns, `*Cents` fields, helpers from `shared/money/money.ts`.
- Tables: write only tables your module owns (ADR 0013 section 4). Read other tables only when documented; otherwise go through the owner's `<name>.public.ts` or an event.
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
