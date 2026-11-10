# Architecture

Status key: **exists** is in the repository today, **migrating** is tutorial code not yet in its final place, **to confirm** is not decided.

## Overview

- Frontend (exists): five Next.js apps in `apps/*`, one per audience. Data is mock and hardcoded; no app calls the API yet.
- Backend (migrating): one Express 5 service, `services/api`, built as a modular monolith. The tutorial code is currently flat under `services/` and is being moved into `services/api` (ADR 0003).
- Database (migrating): PostgreSQL with Drizzle ORM through `pg`. Schema, migrations and `drizzle.config.ts` live in `services/api`.
- Events (exists): RabbitMQ notifications in `services/api/src/events` (ADR 0004). RabbitMQ is optional; the API runs with only Postgres and Redis.
- Local infrastructure (exists): Docker Compose in `infra/docker/docker-compose.yml` with Postgres, Redis and RabbitMQ.

## Repository layout

| Path                     | Role                                             | Status    |
| ------------------------ | ------------------------------------------------ | --------- |
| `apps/*`                 | Next.js dashboards and landing page              | exists    |
| `services/api`           | Express modular monolith, schema and migrations  | migrating |
| `packages/tsconfig`      | Shared TypeScript configs                        | exists    |
| `packages/eslint-config` | Shared ESLint flat configs                       | exists    |
| `packages/ui`            | Shared UI components (placeholder)               | exists    |
| `infra/docker`           | Compose file for local Postgres, Redis, RabbitMQ | exists    |

Workspace packages are scoped `@onemarketplace/<folder-name>`.

## Modular monolith

- One deployable process, `services/api`, split into modules under `src/modules/<name>/` with `route`, `controller` and `service` files. Modules today: admin, agency, auth, client, connects, contracts, freelancer, identity, jobs, meetings, messaging, notifications, payouts, proposals.
- Each module owns its routes, services and validation. A module does not import another module's controller or read its tables directly; it uses a public interface or events.
- Third-party clients (Stripe, Clerk, Daily, ImageKit, Redis, RabbitMQ) are created only in `src/config/`.
- A module may later be extracted into its own service without changing its public interface. See `docs/decisions/0001-modular-monolith.md`.

## API conventions

- ESM with `.js` import suffixes, `@onemarketplace/tsconfig/node.json`, `@onemarketplace/eslint-config/node`.
- zod validates every request at the route boundary. Logging uses pino. Responses use one shape, `{ success, message, data? }`.
- Webhook routes (Stripe, Daily) receive the raw body, registered before `express.json`.
- Tests: vitest and supertest, added after the baseline compiles and runs.

## Database

- PostgreSQL 18 through Drizzle ORM with `drizzle-orm/node-postgres`. Neon is not used.
- Schema in `services/api/src/database/`, generated migrations in `services/api/drizzle/`. Migrations are committed and never edited after merge.
- Connection settings come from `DATABASE_URL`. Migrations run only against local Docker, through `/db-change`.
- Tests use a separate database ending in `_test` (default `<dev database>_test`, or `TEST_DATABASE_URL`). With Docker running, `pnpm --filter @onemarketplace/api db:test:setup` creates it through `docker exec` on the Compose Postgres container and applies the migrations; it works the same in cmd, PowerShell and bash. `db:test:create` and `db:test:migrate` run the two steps alone. The script is `infra/scripts/test-db.mjs`; it refuses names that do not match `^[a-z][a-z0-9_]*_test$`, the dev database name and non-localhost hosts.
- In CI the Postgres service container is created with the test database already, so the workflow only runs `db:test:migrate` with `TEST_DATABASE_URL` set. Set `CREATE_TEST_DB_ADMIN_URL` to create the database through `pg` instead of Docker.

## Local infrastructure

- `pnpm infra:up` starts Postgres 18, Redis 8 and RabbitMQ 4.4.0 (management image) and waits for healthchecks. `infra:down` stops them, `infra:logs` follows logs, `infra:reset` also deletes volumes.
- All services bind to `127.0.0.1` only. Ports default to 5432 (Postgres), 6379 (Redis), 5672 (RabbitMQ AMQP) and 15672 (RabbitMQ management UI).
- Configuration is read from a root `.env` (gitignored). `.env.example` documents the variables; it still needs the API's variables. `RABBITMQ_URL` enables the broker and is optional.
- Compose requires the Postgres, Redis and RabbitMQ (`RABBITMQ_USER`, `RABBITMQ_PASSWORD`) credentials and fails if they are unset.
- See `docs/decisions/0002-local-docker-postgres.md` and `docs/decisions/0004-rabbitmq-replaces-nats.md`.

## Integrations

Clerk (authentication), Stripe (payments, Connect, Identity), Daily (meetings), ImageKit (uploads), RabbitMQ (notification events, ADR 0004), socket.io (messaging) and server-sent events (notifications) are used by the API. Business rules built on them (fees, escrow, disputes) are in the code but still "to confirm" in `docs/product.md`.

## Conventions that apply across layers

- TypeScript everywhere. `typescript` is an alias of `@typescript/typescript6` for typescript-eslint; `tsc` comes from `@typescript/native`. Keep both.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog.
- Run `pnpm check` and `pnpm -r build` before finishing a change.
