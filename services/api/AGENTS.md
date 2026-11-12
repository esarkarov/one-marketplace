# services/api

Express 5 modular monolith. Package name: `@onemarketplace/api`. ESM; import local files with `.js` suffixes. Tutorial code currently sits flat under `services/` and is being moved here module by module (`docs/decisions/0003-api-migration.md`). It is the product source of truth: read a module fully before changing it.

## Layout

- `src/modules/<name>/<name>.{route,controller,service}.ts`: one folder per domain.
- `src/config/`: validated env, pino logger, and every third-party client (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ).
- `src/middleware/`: `validate.middleware.ts` (request validation) and the other middleware. `src/utils/`: `api-error.ts`, `async-handler.ts`, `common-schemas.ts` (shared zod pieces) and `validation-limits.ts` (all max lengths and counts).
- `src/events/`: notification envelope, RabbitMQ topology, publisher and consumer (ADR 0004).
- `src/database/`, `drizzle/`, `drizzle.config.ts`: Drizzle schema, generated migrations, config.

## Rules

- A module does not import another module's controller or internals, and does not query its tables. Use its public interface or an event.
- Third-party clients are created only in `src/config/`. Modules import them from there.
- Validate every body, query and param with zod at the route boundary (ADR 0011):
  - Every route uses `validate({ params, query, body })` from `src/middleware/validate.middleware.ts`, placed after authentication and role middleware.
  - Schemas live in `src/modules/<name>/<name>.schemas.ts`. Limits are defined only in `src/utils/validation-limits.ts`; no inline numbers for lengths or counts.
  - Every `:id` param uses `uuidParam` or `uuidParams` from `src/utils/common-schemas.ts`.
  - Objects are strict. Do not add a route without validation unless it is listed in `src/routes/validation-allowlist.ts` with a written reason. The registry test enforces this.
- Every route declares request and response schemas: `validate({ params, query, body, responses })` with a 2xx entry in `responses` (schemas in `<name>.responses.ts`, shared ones in `src/utils/response-schemas.ts`), and has a contract test that parses real responses with them. Only raw-body webhooks and event streams are exempt, listed with a reason in `src/routes/contract-allowlist.ts`. Run `pnpm --filter @onemarketplace/api openapi:generate` and commit the regenerated `docs/api/openapi.json`; CI fails on drift (ADR 0012).
- Money is always integer cents, never floats: `bigint` `*_cents` columns, `*Cents` API and JSON fields, no `toFixed`, `/ 100` or `Math.round(x * 100)` on money. Use `splitFee`, `toSafeCents`, `moneyCents` and `formatUsd` from `src/utils/money.ts`; shared zod pieces are in `src/utils/money-schemas.ts` (ADR 0006).
- Read configuration only through the config module. Never hardcode secrets or URLs.
- Error responses are `{ success: false, message }`. Never return stack traces, SQL errors or internal messages for 5xx.
- No `console.*`; use the pino logger.
- Webhook routes need the raw body, registered before `express.json`.
- RabbitMQ is optional; the API must start and work with only Postgres and Redis. It is enabled by `RABBITMQ_URL`.
- The RabbitMQ connection is created by `server.ts` at startup; new entry points that publish must start it first.
- Redis is configured with `REDIS_URL`.
- Extend `@onemarketplace/tsconfig/node.json` and `@onemarketplace/eslint-config/node`.
- Schema changes and migrations go only through `/db-change`, against the local Docker database. Never run migrations against Neon or any remote database.
