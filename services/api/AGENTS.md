# services/api

Express 5 modular monolith. Package name: `@onemarketplace/api`. ESM; import local files with `.js` suffixes. Tutorial code currently sits flat under `services/` and is being moved here module by module (`docs/decisions/0003-api-migration.md`). It is the product source of truth: read a module fully before changing it.

## Layout

- `src/modules/<name>/<name>.{route,controller,service}.ts`: one folder per domain.
- `src/config/`: validated env, pino logger, and every third-party client (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ).
- `src/shared/`: errors, async handler, validation helpers, common types.
- `src/events/`: notification envelope, RabbitMQ topology, publisher and consumer (ADR 0004).
- `src/database/`, `drizzle/`, `drizzle.config.ts`: Drizzle schema, generated migrations, config.

## Rules

- A module does not import another module's controller or internals, and does not query its tables. Use its public interface or an event.
- Third-party clients are created only in `src/config/`. Modules import them from there.
- Validate every body, query and param with zod at the route boundary.
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
