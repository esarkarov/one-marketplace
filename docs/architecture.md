# Architecture

Status key: **exists** is in the repository today, **migrating** is tutorial code not yet in its final place, **to confirm** is not decided.

## Overview

- Frontend (exists): five Next.js apps in `apps/*`, one per audience. Data is mock and hardcoded; no app calls the API yet.
- Backend (migrating): one Express 5 service, `services/api`, built as a modular monolith. The tutorial code is currently flat under `services/` and is being moved into `services/api` (ADR 0003).
- Database (migrating): PostgreSQL with Drizzle ORM through `pg`. Schema, migrations and `drizzle.config.ts` live in `services/api`.
- Events (exists): RabbitMQ notifications: envelope, topology and publisher in `services/api/src/infrastructure/events`, consumer in `src/modules/notifications/notifications.consumer.ts` (ADR 0004). RabbitMQ is optional; the API runs with only Postgres and Redis. The envelope is version 2 (`metadata.amountCents`); version 1 is still accepted and upgraded (ADR 0006).
- API contract (exists): `docs/api/openapi.json`, OpenAPI 3.1 generated from the route zod schemas and committed; CI fails on drift (ADR 0012). No runtime endpoint serves it.
- Local infrastructure (exists): Docker Compose in `infra/docker/docker-compose.yml` with Postgres, Redis and RabbitMQ.

## Repository layout

| Path                     | Role                                             | Status    |
| ------------------------ | ------------------------------------------------ | --------- |
| `apps/*`                 | Next.js dashboards and landing page              | exists    |
| `services/api`           | Express modular monolith, schema and migrations  | migrating |
| `docs/api/openapi.json`  | OpenAPI 3.1 contract generated from the API      | exists    |
| `packages/tsconfig`      | Shared TypeScript configs                        | exists    |
| `packages/eslint-config` | Shared ESLint flat configs                       | exists    |
| `packages/ui`            | Shared UI components (placeholder)               | exists    |
| `infra/docker`           | Compose file for local Postgres, Redis, RabbitMQ | exists    |

Workspace packages are scoped `@onemarketplace/<folder-name>`.

## Modular monolith

- One deployable process, `services/api`, split into modules under `src/modules/<name>/` in one folder layout (ADR 0016): `controllers/`, `services/`, `repositories/`, `models/`, `schemas/`, `responses/`, `middleware/`, `tests/`, plus `types/`, `constants/` and `utils/` when needed, with `<name>.route.ts`, `index.ts` and the `.socket`, `.cron` and `.consumer` entry points at the module root. Modules today: admin, agency, auth, client, connects, contracts, freelancer, health, identity, jobs, meetings, messaging, notifications, payouts, proposals. `contracts` is split by use case into `services/` (checkout, listing, lifecycle, milestones) and a `repositories/contracts.repository.ts` of executor-first read functions (services keep transactions, locks and state-guarded statements) (ADR 0014).
- Layout under `src/` (ADR 0013, ADR 0014): `server.ts` and `app.ts`; `bootstrap/` (ordered start, shutdown, readiness); `config/` (validated env, constants, cors, logger, webhooks); `infrastructure/` (one folder per third-party service: `auth/`, `cache/`, `events/`, `payments/`, `storage/`, `video/`); `middleware/` (one folder per middleware plus `constants/`, `types/`, `utils/`; ADR 0013 "Shared and middleware layout"); `shared/` (`errors`, `responses`, `validation`, `money`, `logging`, `uploads`, `ids`); `database/` (client, executor, `pg-errors.ts`); `routes/` (route assembly and registries); `openapi/`; `types/`; `test/`.
- Module layout (ADR 0016): the folder set, the module root and the suffix-to-folder rules are enforced without exemptions by `src/test/architecture/module-layout.test.ts`. `models/<name>.model.ts` is drizzle and `schemas/<x>.schema.ts` is zod.
- Each module owns its routes, services and validation. A module imports only `config`, `infrastructure`, `shared` and `database`, and only a strictly lower module layer, through that module's `index.ts` (today agency, auth, connects, freelancer, jobs and messaging), never its controller or internals. No cycles.
- Module layers: 0 auth, health; 1 admin, client, identity, jobs, payouts, connects; 2 freelancer; 3 agency; 4 messaging; 5 meetings, notifications, proposals; 6 contracts (ADR 0014 section 10). The layer table, the module boundary, the infrastructure-to-module direction and cycles are enforced by `src/test/architecture/import-boundaries.test.ts`; its exception list (`boundary-exceptions.ts`) is empty, and no file inside a module imports its own `index.ts` (ADR 0017).
- Table ownership: one owner per table (list in ADR 0013 section 4). Other modules may read a table they do not own, never write it. Cross-module writes go through owner functions, which take the executor first and do SQL only (ADR 0014 section 11): `messaging/index.ts` (`appendConversationMessages`, `openInterviewConversation`), `auth/index.ts` (account writes), `jobs/index.ts` (`appendJobMilestone`) and `connects/index.ts` (`debitConnects`, `creditConnects`, `recordConnectsHistory`). `src/test/architecture/table-access-allowlist.ts` lists reads only; `table-access.test.ts` enforces it, the allowlist type cannot express a write, and a detected cross-module write fails the test (ADR 0014 sections 9 and 11).
- SQL belongs in `repositories/<module>.repository.ts` files and `index.ts` only re-exports (ADR 0015). Every module is converted and there is no exemption list: `repository-sql.test.ts` fails on any file outside `database/`, `bootstrap/`, tests, table files and repositories that holds SQL, and `repository-purity.test.ts` fails on an `ApiError`, a `throw` or non-SQL I/O inside a repository. `auth.middleware.ts` lives in `modules/auth`. A thin service that only supplies `db` to a repository function is acceptable.
- Third-party clients (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) are created only in `src/infrastructure/`; eslint forbids importing their packages elsewhere. This amends the earlier `src/config/` rule (ADR 0013). `config/` holds configuration only.
- A module may later be extracted into its own service without changing its public interface. See `docs/decisions/0001-modular-monolith.md`.

## API conventions

- ESM with `.js` import suffixes, `@onemarketplace/tsconfig/node.json`, `@onemarketplace/eslint-config/node`.
- Every route is validated at the route layer by `validate` (`src/middleware/validate/validate.middleware.ts`). Schemas live in `src/modules/<module>/schemas/<x>.schema.ts`, limits in each module's `constants/<module>.constants.ts` (shared ones in `src/shared/validation/constants/`). A registry test and `src/test/architecture/routing/validation-allowlist.ts` enforce it (ADR 0011).
- Every route also declares response schemas through `validate({ ..., responses })` with a 2xx entry (`responses/<module>.responses.ts`, shared pieces in `src/shared/responses/`) and has a contract test; only raw-body webhooks and event streams are exempt (`src/openapi/contract-allowlist.ts`). `pnpm --filter @onemarketplace/api openapi:generate` writes `docs/api/openapi.json`, which is committed (ADR 0012).
- zod validates every request at the route boundary. Logging uses pino. Responses use one shape, `{ success, message, data? }`.
- Webhook routes (Stripe, Daily) receive the raw body, registered before `express.json`.
- Tests: vitest and supertest, added after the baseline compiles and runs.
- Money is always integer cents (`bigint` columns named `*_cents`, JS numbers within the safe-integer range, API and JSON fields named `*Cents`), never floats. Fees use `splitFee` in `src/shared/money/money.ts` (half-up on cents). See `docs/decisions/0006-money-in-integer-cents.md`, which also lists every renamed API field.
- Status transitions are single guarded conditional `UPDATE`s; a lost race answers a coded 409 (`docs/decisions/0007-guarded-state-transitions.md`).

## Database

- PostgreSQL 18 through Drizzle ORM with `drizzle-orm/node-postgres`. Neon is not used.
- Schema: tables and enums live in the owning module as `modules/<name>/models/<name>.model.ts` (ADR 0014 section 9, ADR 0016); there is no central schema. `drizzle.config.ts` reads the glob `./src/modules/*/models/*.model.ts`. `services/api/src/database/` keeps the client (created without a schema), the executor type and `pg-errors.ts`, and stays outside `infrastructure/` (ADR 0013);
- Connection settings come from `DATABASE_URL`. Migrations run only against local Docker, through `/db-change`.
- Tests use a separate database ending in `_test` (default `<dev database>_test`, or `TEST_DATABASE_URL`). With Docker running, `pnpm --filter @onemarketplace/api db:test:setup` creates it through `docker exec` on the Compose Postgres container and applies the migrations; it works the same in cmd, PowerShell and bash. `db:test:create` and `db:test:migrate` run the two steps alone. The script is `infra/scripts/test-db.mjs`; it refuses names that do not match `^[a-z][a-z0-9_]*_test$`, the dev database name and non-localhost hosts.
- In CI the Postgres service container is created with the test database already, so the workflow only runs `db:test:migrate` with `TEST_DATABASE_URL` set. Set `CREATE_TEST_DB_ADMIN_URL` to create the database through `pg` instead of Docker.

## Local infrastructure

- `pnpm infra:up` starts Postgres 18, Redis 8 and RabbitMQ 4.4.0 (management image) and waits for healthchecks. `infra:down` stops them, `infra:logs` follows logs, `infra:reset` also deletes volumes.
- All services bind to `127.0.0.1` only. Ports default to 5432 (Postgres), 6379 (Redis), 5672 (RabbitMQ AMQP) and 15672 (RabbitMQ management UI).
- Configuration is read from a root `.env` (gitignored). `.env.example` documents the variables; it still needs the API's variables. `RABBITMQ_URL` enables the broker and is optional.
- With `NODE_ENV=production` the API refuses to start unless `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECTS_WEBHOOK_SECRET`, `STRIPE_IDENTITY_WEBHOOK_SECRET`, `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET` (at least 32 characters) are set and none contains `change-me`. CORS has no localhost fallback in production, so at least one of `CLIENT_DASHBOARD`, `FREELANCER_DASHBOARD`, `AGENCY_DASHBOARD` and `ADMIN_DASHBOARD` must be set, and every value set must be a valid http(s) URL; otherwise startup fails. Other environments keep these optional.
- Compose requires the Postgres, Redis and RabbitMQ (`RABBITMQ_USER`, `RABBITMQ_PASSWORD`) credentials and fails if they are unset.
- See `docs/decisions/0002-local-docker-postgres.md` and `docs/decisions/0004-rabbitmq-replaces-nats.md`.

## Integrations

Clerk (authentication), Stripe (payments, Connect, Identity), Daily (meetings), ImageKit (uploads), RabbitMQ (notification events, ADR 0004), socket.io (messaging) and server-sent events (notifications) are used by the API. Business rules built on them (fees, escrow, disputes) are in the code but still "to confirm" in `docs/product.md`.

## Conventions that apply across layers

- TypeScript everywhere. `typescript` is an alias of `@typescript/typescript6` for typescript-eslint; `tsc` comes from `@typescript/native`. Keep both.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog.
- Run `pnpm check` and `pnpm -r build` before finishing a change.
- CI jobs, the required `ci-pass` check and how to run each check locally are in `docs/ci.md`.
