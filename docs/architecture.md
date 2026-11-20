# Architecture

Status key: **exists** is in the repository today, **migrating** is code not yet in its final place (none today), **to confirm** is not decided.

## Overview

- Frontend (exists): five Next.js apps in `apps/*`, one per audience. The apps call the API directly from the browser with Clerk Bearer tokens and TanStack Query (admin goes through same-origin route handlers). Their data layer still uses the old shapes (bare arrays, snake_case fields, dollars) and the migration to the API contract is in progress (`docs/frontend-migration-plan.md`).
- Backend (exists): one Express 5 service, `services/api`, built as a modular monolith. The tutorial code has been moved into it and `services/` holds nothing else (ADR 0003).
- Database (exists): PostgreSQL with Drizzle ORM through `pg`. Schema, migrations and `drizzle.config.ts` live in `services/api`.
- Events (exists): RabbitMQ notifications: envelope, topology and publisher (`notification.*.ts`) in `services/api/src/infrastructure/events`, consumer in `src/modules/notifications/notifications.consumer.ts` (ADR 0004). RabbitMQ is optional for the API to start, but today it is the only path that writes a notification row, so without it no notice is stored (ADR 0004, correction 2026-11-19); ADR 0024 moves the must-not-lose notices (contract offer, milestone, cancel, payout, interview and invitation notices) into the business transaction through `notification-store`, which also owns the SSE push entry point; only the nice-to-have notices still depend on the broker. The envelope is version 2 (`metadata.amountCents`) and version 1 is rejected (ADR 0006).
- API contract (exists): `docs/api/openapi.json`, OpenAPI 3.1 generated from the route zod schemas and committed; CI fails on drift (ADR 0012). No runtime endpoint serves it.
- Local infrastructure (exists): Docker Compose in `infra/docker/docker-compose.yml` with Postgres, Redis, RabbitMQ and Swagger UI (port 8081, serves `docs/api/openapi.json`).

## Repository layout

| Path                     | Role                                                         | Status |
| ------------------------ | ------------------------------------------------------------ | ------ |
| `apps/*`                 | Next.js dashboards and landing page                          | exists |
| `services/api`           | Express modular monolith, schema and migrations              | exists |
| `docs/api/openapi.json`  | OpenAPI 3.1 contract generated from the API                  | exists |
| `packages/tsconfig`      | Shared TypeScript configs                                    | exists |
| `packages/eslint-config` | Shared ESLint flat configs                                   | exists |
| `packages/ui`            | Shared UI components (placeholder)                           | exists |
| `infra/docker`           | Compose file for local Postgres, Redis, RabbitMQ, Swagger UI | exists |

Workspace packages are scoped `@onemarketplace/<folder-name>`.

## Modular monolith

- One deployable process, `services/api`, split into modules under `src/modules/<name>/` in one folder layout (ADR 0016): `controllers/`, `services/`, `repositories/`, `models/`, `schemas/`, `responses/`, `middleware/`, `tests/`, plus `types/`, `constants/` and `utils/` when needed, with `<name>.route.ts`, `index.ts` and the `.socket`, `.cron` and `.consumer` entry points at the module root. Modules today: admin, agency, auth, client, connects, contracts, freelancer, health, identity, jobs, meetings, messaging, notification-store, notifications, payouts, proposals. `contracts` is split by use case into `services/` (checkout, listing, lifecycle, milestones) and a `repositories/contracts.repository.ts` of executor-first read functions (services keep transactions, locks and state-guarded statements) (ADR 0014).
- Layout under `src/` (ADR 0013, ADR 0014): `server.ts` and `app.ts`; `bootstrap/` (ordered start, shutdown, readiness); `config/` (validated env, constants, cors, logger, webhooks); `infrastructure/` (one folder per third-party service: `auth/`, `cache/`, `events/`, `payments/`, `storage/`, `video/`, plus shared `constants/`, `types/`, `utils/`; ADR 0013 "Infrastructure layout"); `middleware/` (one folder per middleware plus `constants/`, `types/`, `utils/`; ADR 0013 "Shared and middleware layout"); `shared/` (`errors`, `responses`, `validation`, `money`, `logging`, `uploads`, `ids`); `database/` (client, executor, `pg-errors.ts`); `routes/` (route assembly and registries); `openapi/`; `types/`; `test/`.
- Module layout (ADR 0016): the folder set, the module root and the suffix-to-folder rules are enforced without exemptions by `src/test/architecture/module-layout.test.ts`. `models/<name>.model.ts` is drizzle and `schemas/<x>.schema.ts` is zod.
- Each module owns its routes, services and validation. A module imports only `config`, `infrastructure`, `shared` and `database`, and only a strictly lower module layer, through that module's `index.ts` (today agency, auth, connects, freelancer, health, jobs, messaging, payouts and proposals; `contracts/index.ts` exports only the refund reconciliation cron entry points for bootstrap), never its controller or internals. No cycles.
- Module layers: 0 auth, health, notification-store; 1 admin, client, identity, jobs, payouts, connects; 2 freelancer; 3 agency; 4 messaging; 5 meetings, notifications, proposals; 6 contracts (ADR 0014 section 10). The layer table, the module boundary, the infrastructure-to-module direction and cycles are enforced by `src/test/architecture/import-boundaries.test.ts`; its exception list (`boundary-exceptions.ts`) is empty, and no file inside a module imports its own `index.ts` (ADR 0017).
- Table ownership: one owner per table (list in ADR 0013 section 4; ADR 0024 moves `notifications` to the layer-0 `notification-store`, which exposes `insertNotification`, `markAllNotificationsRead`, `markNotificationReadForRecipient`, `pushStoredNotification` and `registerNotificationPusher` in its `index.ts`; `notifications` reads the table through the store's table file). Other modules may read a table they do not own, never write it. Cross-module writes go through owner functions, which take the executor first and do SQL only (ADR 0014 section 11): `messaging/index.ts` (`appendConversationMessages`, `openInterviewConversation`), `auth/index.ts` (account writes, `syncAccountDisplay`), `jobs/index.ts` (`appendJobMilestone`) and `connects/index.ts` (`debitConnects`, `creditConnects`, `recordConnectsHistory`). `src/test/architecture/table-access-allowlist.ts` lists reads only; `table-access.test.ts` enforces it, the allowlist type cannot express a write, and a detected cross-module write fails the test (ADR 0014 sections 9 and 11).
- SQL belongs in `repositories/<module>.repository.ts` files and `index.ts` only re-exports (ADR 0015). The rule and the tests that enforce it (`repository-sql.test.ts`, `repository-purity.test.ts`) are in `services/api/AGENTS.md`. `auth.middleware.ts` lives in `modules/auth`.
- Third-party clients (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) are created only in `src/infrastructure/`; eslint forbids importing their packages elsewhere. The Stripe, Clerk and ImageKit clients are lazy (`createLazyClient`); ImageKit has no key fallback and throws `IMAGEKIT_PRIVATE_KEY is missing from the environment.` on first use. This amends the earlier `src/config/` rule (ADR 0013). `config/` holds configuration only.
- Lifecycle (ADR 0013 "Lifecycle hardening"): `start` checks the database with `pingDatabase` (`modules/health/index.ts`, also used by the admin health check and the notification consumer's resume), connects Redis, listens, and only then registers the notification pusher (always, with or without RabbitMQ) and starts the notification consumer, messaging socket, payout cron, refund reconciliation cron (`*/15 * * * *`, ADR 0023; nothing is scheduled when `REFUND_RECONCILIATION_MODE=off`) and orphan payment detection cron (`17 * * * *`, ADR 0008; nothing is scheduled when `ORPHAN_PAYMENT_DETECTION_MODE=off`). A listen or startup failure exits 1. `server.ts` registers the `unhandledRejection` and `uncaughtException` handlers once; they log, run the graceful `shutdown` and exit 1. `shutdown` stops the payout, refund reconciliation and orphan detection crons, waits for their in-flight runs together (bounded, then warns and continues) and closes the HTTP server, clears the notification pusher, and closes the consumer, RabbitMQ, Redis and the pool in that order.
- A module may later be extracted into its own service without changing its public interface. See `docs/decisions/0001-modular-monolith.md`.

## API conventions

- ESM with `.js` import suffixes, `@/` for cross-directory imports (ADR 0020), `@onemarketplace/tsconfig/node.json`, `@onemarketplace/eslint-config/node`.
- Every route is validated at the route layer and read through `getValidated` (ADR 0011); the rule, file locations and enforcing tests are in `services/api/AGENTS.md`.
- Every route also declares response schemas through `validate({ ..., responses })` with a 2xx entry (`responses/<module>.responses.ts`, shared pieces in `src/shared/responses/`) and has a contract test; only raw-body webhooks and event streams are exempt (`src/openapi/introspection/contract-allowlist.ts`). `pnpm --filter @onemarketplace/api openapi:generate` writes `docs/api/openapi.json`, which is committed (ADR 0012).
- zod validates every request at the route boundary. Logging uses pino. Responses use one shape, `{ success, message, data? }`.
- Webhook routes (Stripe, Daily) receive the raw body, registered before `express.json`.
- Tests: vitest and supertest in two projects (`vitest.config.ts`): `parallel`, and `payout-totals`, which runs serially afterwards for files that read global rows.
- Money is always integer cents (`bigint` columns named `*_cents`, JS numbers within the safe-integer range, API and JSON fields named `*Cents`), never floats. Fees use `splitFee` in `src/shared/money/money.ts` (half-up on cents). See `docs/decisions/0006-money-in-integer-cents.md`, which also lists every renamed API field.
- Status transitions are single guarded conditional `UPDATE`s; a lost race answers a coded 409 (`docs/decisions/0007-guarded-state-transitions.md`).

## Database

- PostgreSQL 18 through Drizzle ORM with `drizzle-orm/node-postgres`. Neon is not used.
- Schema: tables and enums live in the owning module as `modules/<name>/models/<name>.model.ts` (ADR 0014 section 9, ADR 0016); there is no central schema. `drizzle.config.ts` reads the glob `./src/modules/*/models/*.model.ts`. `services/api/src/database/` keeps the client (created without a schema), the executor type and `pg-errors.ts`, and stays outside `infrastructure/` (ADR 0013);
- Searchable text (ADR 0019): `accounts.display_name`/`avatar_url`, `freelancer_metadata.search_text`/`location_text` and `agency_metadata.search_text` are denormalized in the owner's write path; the freelancer, agency, marketplace and public job searches match them in SQL (matchAllTerms: terms ANDed, ILIKE).
- Stored display data and client country (ADR 0019, batch 3): list and profile paths read names and avatars from `accounts.display_name`/`avatar_url` through `findAccountDisplays` (`modules/auth/index.ts`, one batched query, never Clerk) and the client country from `client_metadata.country` (nullable ISO alpha-2, set by `PUT /client/profile`). Clerk `getUser` is called only at signup, in `syncAccountDisplay` (signup, profile saves, invitation answers, backfill), for the admin account and listing names and for the earnings certificate.
- Connection settings come from `DATABASE_URL`. The pool (`src/database/client.ts`, limits in `database.constants.ts`) allows 10 clients, a 10 s connection timeout, a 30 s idle timeout, a 60 s `statement_timeout` and a 60 s `idle_in_transaction_session_timeout`; an idle client error is logged as `database.pool.error` and does not stop the process. Migrations run only against local Docker, through `/db-change`.
- Tests use a separate database ending in `_test` (default `<dev database>_test`, or `TEST_DATABASE_URL`). With Docker running, `pnpm --filter @onemarketplace/api db:test:setup` creates it through `docker exec` on the Compose Postgres container and applies the migrations; it works the same in cmd, PowerShell and bash. `db:test:create` and `db:test:migrate` run the two steps alone. The script is `infra/scripts/test-db.mjs`; it refuses names that do not match `^[a-z][a-z0-9_]*_test$`, the dev database name and non-localhost hosts.
- In CI the Postgres service container is created with the test database already, so the workflow only runs `db:test:migrate` with `TEST_DATABASE_URL` set. Set `CREATE_TEST_DB_ADMIN_URL` to create the database through `pg` instead of Docker.

## Local infrastructure

- `pnpm infra:up` starts Postgres 18, Redis 8 and RabbitMQ 4.4.0 (management image) and waits for healthchecks. `infra:down` stops them, `infra:logs` follows logs, `infra:reset` also deletes volumes.
- All services bind to `127.0.0.1` only. Ports default to 5432 (Postgres), 6379 (Redis), 5672 (RabbitMQ AMQP) and 15672 (RabbitMQ management UI).
- Configuration is read from a root `.env` (gitignored). `.env.example` documents the variables (except the optional `SWAGGER_PORT`). `RABBITMQ_URL` enables the broker and is optional.
- Production start validates the environment in `src/config/env.ts`; the variables and which are required are in [Production environment](#production-environment).
- Compose requires the Postgres, Redis and RabbitMQ (`RABBITMQ_USER`, `RABBITMQ_PASSWORD`) credentials and fails if they are unset.
- See `docs/decisions/0002-local-docker-postgres.md` and `docs/decisions/0004-rabbitmq-replaces-nats.md`.

## Integrations

Clerk (authentication), Stripe (payments, Connect, Identity), Daily (meetings; private rooms joined with per-user meeting tokens, ADR 0021), ImageKit (uploads), RabbitMQ (notification events, ADR 0004), socket.io (messaging) and server-sent events (notifications) are used by the API. Business rules built on them (fees, escrow, disputes) are in the code but still "to confirm" in `docs/product.md`.

## Conventions that apply across layers

- TypeScript everywhere. `typescript` is an alias of `@typescript/typescript6` for typescript-eslint; `tsc` comes from `@typescript/native`. Keep both.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog.
- Run `pnpm check` and `pnpm -r build` before finishing a change.
- CI jobs, the required `ci-pass` check and how to run each check locally are in `docs/ci.md`.

## Production environment

Read by `services/api/src/config/env.ts`. `.env.example` is owned by the repository owner and is not the list below. Values are never documented here.

| Variable                                                                                                         | Required                                  | Purpose                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                   | always (`postgres://` or `postgresql://`) | Postgres connection                                                                           |
| `REDIS_URL`                                                                                                      | always (`redis://` or `rediss://`)        | Redis (rate limits, caches)                                                                   |
| `NODE_ENV`                                                                                                       | optional, default `development`           | `production` turns on the checks in this table                                                |
| `PORT`                                                                                                           | optional, default 4000                    | API port                                                                                      |
| `TRUST_PROXY`                                                                                                    | optional                                  | Proxy hop count or subnet list; `true` is rejected                                            |
| `REFUND_RECONCILIATION_MODE`                                                                                     | optional, default `detect`                | `off` schedules nothing; `detect` logs stuck refunds only; `on` retries them (ADR 0023)       |
| `ORPHAN_PAYMENT_DETECTION_MODE`                                                                                  | optional, default `detect`                | `off` schedules nothing; `detect` logs paid contract sessions with no milestone (ADR 0008)    |
| `RABBITMQ_URL`                                                                                                   | optional (`amqp://` or `amqps://`)        | Enables notification events                                                                   |
| `CLERK_SECRET_KEY`                                                                                               | production                                | Authentication                                                                                |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECTS_WEBHOOK_SECRET`, `STRIPE_IDENTITY_WEBHOOK_SECRET` | production                                | Stripe API and the three webhook signing secrets                                              |
| `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`                                                                          | production                                | Daily meetings and webhook verification                                                       |
| `IMAGEKIT_PRIVATE_KEY`                                                                                           | production                                | ImageKit uploads                                                                              |
| `ADMIN_DASHBOARD_PASSWORD`, `ADMIN_SESSION_SECRET`                                                               | production                                | Admin sign-in; the session secret must be at least 32 characters                              |
| `CLIENT_DASHBOARD`, `FREELANCER_DASHBOARD`, `AGENCY_DASHBOARD`, `ADMIN_DASHBOARD`, `LANDING_PAGE`                | production: at least one                  | Allowed browser origins; every one set must be an http(s) URL; there is no localhost fallback |

In production none of the "production" values may contain `change-me`, and startup fails with the list of problems otherwise. Outside production they are optional and the matching feature fails when used. Only the compose stack reads `POSTGRES_*`, `REDIS_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, the `*_PORT` variables and `SWAGGER_PORT`; the API reads `DATABASE_URL` and `REDIS_URL`.

The database must be created with a UTF-8 locale (for example `en_US.utf8`; the local `postgres:18-alpine` container does this by default). The best-match job feed lowercases text in SQL, and under the C locale non-ASCII letters such as `İ` or the Kelvin sign are not lowercased and are then dropped instead of mapped to ASCII (ADR 0022, update).
