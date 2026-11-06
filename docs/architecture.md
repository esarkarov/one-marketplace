# Architecture

Status key: **exists** is in the repository today, **planned** is described in the README roadmap but not built, **to confirm** is not decided.

## Overview

- Frontend (exists): five Next.js apps in `apps/*`, one per audience. Data is mock and hardcoded; no app calls a backend yet.
- Backend (planned): one Express service, `services/api`, built as a modular monolith.
- Database (planned): PostgreSQL with Drizzle ORM. Schema and migrations live in `packages/db`.
- Events (planned): contracts and helpers in `packages/events`. The README lists NATS JetStream as the broker; to confirm.
- Local infrastructure (exists): Docker Compose in `infra/docker/docker-compose.yml` with Postgres and Redis.

## Repository layout

| Path                     | Role                                          | Status  |
| ------------------------ | --------------------------------------------- | ------- |
| `apps/*`                 | Next.js dashboards and landing page           | exists  |
| `services/api`           | Express modular monolith                      | planned |
| `packages/db`            | Drizzle schema, migrations, DB client         | planned |
| `packages/events`        | Event contracts shared by producers/consumers | planned |
| `packages/tsconfig`      | Shared TypeScript configs                     | exists  |
| `packages/eslint-config` | Shared ESLint flat configs                    | exists  |
| `packages/ui`            | Shared UI components (placeholder)            | exists  |
| `infra/docker`           | Compose file for local Postgres and Redis     | exists  |

Workspace packages are scoped `@onemarketplace/<folder-name>`.

## Modular monolith (planned)

- One deployable process, `services/api`, split into modules by domain (for example jobs, proposals, contracts, payments, messaging). Module names are to confirm.
- Each module owns its tables, routes, services and validation. Other modules call its public interface or react to its events; they do not read its tables directly.
- A module may later be extracted into its own service without changing its public interface. See `docs/decisions/0001-modular-monolith.md`.

## Database (planned)

- PostgreSQL 18 through Drizzle ORM. Schema and migrations are owned by `packages/db`; `services/api` imports the client and tables from it.
- Migrations are generated and committed, never edited after they are merged.
- Connection settings come from `DATABASE_URL`.

## Local infrastructure (exists)

- `pnpm infra:up` starts Postgres 18 and Redis 8 and waits for healthchecks. `infra:down` stops them, `infra:logs` follows logs, `infra:reset` also deletes volumes.
- Both services bind to `127.0.0.1` only. Ports default to 5432 and 6379.
- Configuration is read from a root `.env` (gitignored). `.env.example` lists every variable: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `REDIS_PASSWORD`, `REDIS_PORT`, `DATABASE_URL`, `REDIS_URL`.
- Compose requires the Postgres and Redis credentials and fails if they are unset.
- See `docs/decisions/0002-local-docker-postgres.md`.
- NATS JetStream appears in the README roadmap but is not in the compose file yet.

## Other planned integrations

The README names these as planned. None are decided or wired up; all are to confirm: Clerk (authentication), Stripe (payments), ImageKit (file storage), server-sent events and Socket.IO (real-time), Redis usage (cache, sessions or queues).

## Conventions that apply across layers

- TypeScript everywhere. `typescript` is an alias of `@typescript/typescript6` for typescript-eslint; `tsc` comes from `@typescript/native`. Keep both.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog.
- Run `pnpm check` and `pnpm -r build` before finishing a change.
