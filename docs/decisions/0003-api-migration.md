# 0003: Migrating the tutorial API into services/api

Status: accepted

## Context

A full tutorial API (Express, Drizzle, Clerk, Stripe, Daily, ImageKit, Redis, NATS, socket.io) was added under `services/` as flat files. It is the source of truth for product behavior and must become the `services/api` package described in ADR 0001.

## Decisions

1. Database driver: `pg` with `drizzle-orm/node-postgres`, against the local Docker Postgres from ADR 0002. The Neon serverless driver is dropped.
2. `packages/db` is not created. The Drizzle schema (`src/database/`), migrations (`drizzle/`) and `drizzle.config.ts` live in `services/api`. Events live in `services/api/src/events`; extract a package only when a second consumer needs them.
3. The tutorial code is the product source of truth. `docs/product.md` is not rewritten yet; its "to confirm" items are resolved later from the code.
4. Clerk (auth), Stripe (payments, Connect, Identity), Daily (meetings) and ImageKit (uploads) stay. OneMinuteLogs is replaced by pino.
5. NATS is optional: the API must start and run with only Postgres and Redis. Redis is configured with `REDIS_URL`.
6. Validation uses zod. Tests use vitest and supertest, added once the baseline compiles and runs.
7. Express 5, ESM, imports with `.js` suffixes.

## Consequences

- Schema changes go through `/db-change`, owned by the `database` agent inside `services/api`, and run only against local Docker.
- The `backend` agent migrates and changes tutorial code module by module, reading each module first.
- Docs and agent files that mention `packages/db` or "planned" backend code are updated to match.
- `.env.example` and `infra/` need follow-up changes (`REDIS_URL`, optional NATS); they are not part of this decision's docs update.
