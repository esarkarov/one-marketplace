# services/api

Express 5 modular monolith. Package name: `@onemarketplace/api`. ESM; import local files with `.js` suffixes. Tutorial code currently sits flat under `services/` and is being moved here module by module (`docs/decisions/0003-api-migration.md`). It is the product source of truth: read a module fully before changing it.

## Layout

Source layout and import rules: `docs/decisions/0013-api-source-layout-and-import-boundaries.md`. To add a module or route, follow `docs/adding-an-api-module.md`.

- `src/modules/<name>/<name>.{route,controller,service,schemas,responses,types}.ts`: one folder per domain; `<name>.public.ts` only where another module needs it (agency, connects, freelancer, messaging).
- `src/infrastructure/`: every third-party client (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) and adapter, plus `events/` (envelope, topology, publisher; ADR 0004). The consumer is `modules/notifications/notifications.consumer.ts`.
- `src/app-middleware/`: middleware composed only by `app.ts` (error handler, http logger, not-found, request id). It never imports modules (ADR 0014).
- `src/shared/`: `http/` (`validate.middleware.ts`, `api-error.ts`, `async-handler.ts`; `auth/` with the auth, admin-session and role guards; `limits/` with json-body and rate limiters), `validation/` (`common-schemas.ts`, `validation-limits.ts` with all max lengths and counts, `response-schemas.ts`, `money-schemas.ts`), `money/money.ts`, `logging/` (`sanitize-log.ts`), `uploads/` (`attachments.ts`, `portfolio-images.ts`), `ids/` (`uuid-v5.ts`); `email.ts` lives in `validation/`.
- `src/config/`: validated env, constants, cors, pino logger, webhooks. Configuration only.
- `src/bootstrap/`: ordered start, shutdown and readiness. `src/routes/`: route assembly and the validation and contract allowlists.
- `src/database/`, `drizzle/`, `drizzle.config.ts`: Drizzle schema, generated migrations, config.

## Rules

- Third-party clients are created only in `src/infrastructure/` (eslint enforces it). Modules import them from there.
- A module imports only `config`, `infrastructure`, `shared`, `database` and lower-layer modules, and only through the other module's `<name>.public.ts`, never its controller or internals. Do not write tables you do not own (ADR 0013). `src/test/architecture/import-boundaries.test.ts` enforces this; its exception list stays empty and cycles are never allowed.
- Validate every body, query and param with zod at the route boundary (ADR 0011):
  - Every route uses `validate({ params, query, body })` from `src/shared/http/validate.middleware.ts`, placed after authentication and role middleware.
  - Schemas live in `src/modules/<name>/<name>.schemas.ts`. Limits are defined only in `src/shared/validation/validation-limits.ts`; no inline numbers for lengths or counts.
  - Every `:id` param uses `uuidParam` or `uuidParams` from `src/shared/validation/common-schemas.ts`.
  - Objects are strict. Do not add a route without validation unless it is listed in `src/routes/validation-allowlist.ts` with a written reason. The registry test enforces this.
- Every route declares request and response schemas: `validate({ params, query, body, responses })` with a 2xx entry in `responses` (schemas in `<name>.responses.ts`, shared ones in `src/shared/validation/response-schemas.ts`), and has a contract test that parses real responses with them. Only raw-body webhooks and event streams are exempt, listed with a reason in `src/routes/contract-allowlist.ts`. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`; CI fails on drift (ADR 0012).
- Money is always integer cents, never floats: `bigint` `*_cents` columns, `*Cents` API and JSON fields, no `toFixed`, `/ 100` or `Math.round(x * 100)` on money. Use `splitFee`, `toSafeCents`, `moneyCents` and `formatUsd` from `src/shared/money/money.ts`; shared zod pieces are in `src/shared/validation/money-schemas.ts` (ADR 0006).
- Read configuration only through the config module. Never hardcode secrets or URLs.
- Error responses are `{ success: false, message }`. Never return stack traces, SQL errors or internal messages for 5xx.
- No `console.*`; use the pino logger.
- Webhook routes need the raw body, registered before `express.json`.
- RabbitMQ is optional; the API must start and work with only Postgres and Redis. It is enabled by `RABBITMQ_URL`.
- The RabbitMQ connection is created at startup by `src/bootstrap/start.ts`; new entry points that publish must start it first.
- Redis is configured with `REDIS_URL`.
- Extend `@onemarketplace/tsconfig/node.json` and `@onemarketplace/eslint-config/node`.
- Schema changes and migrations go only through `/db-change`, against the local Docker database. Never run migrations against Neon or any remote database.
