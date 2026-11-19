# OneMarketplace

OneMarketplace is a freelancing marketplace built as a pnpm monorepo. Clients post jobs, freelancers and agencies apply, and the API handles proposals, contracts, milestones and payments.

The five Next.js apps currently use mock data and do not call the API yet; they use none of Clerk, Stripe, Daily or ImageKit. The API in `services/api` is built and tested on its own. What the apps must change before they can call it is in [`docs/frontend-integration-notes.md`](docs/frontend-integration-notes.md).

## Modules

Apps in `apps/`:

- `landing-page`: public site.
- `client-dashboard`, `freelancer-dashboard`, `agency-dashboard`: one workspace per role.
- `admin-dashboard`: admin console.

API modules in `services/api/src/modules/`:

| Module          | Area                                                |
| --------------- | --------------------------------------------------- |
| `auth`          | Authentication with Clerk                           |
| `identity`      | Identity verification (Stripe Identity webhook)     |
| `client`        | Client routes                                       |
| `freelancer`    | Freelancer routes                                   |
| `agency`        | Agency routes                                       |
| `jobs`          | Job postings                                        |
| `proposals`     | Proposals on jobs                                   |
| `contracts`     | Contracts, milestones and payments (Stripe webhook) |
| `connects`      | Connects purchases (Stripe webhook)                 |
| `payouts`       | Payouts                                             |
| `meetings`      | Meetings with Daily (Daily webhook)                 |
| `messaging`     | Real-time messaging over Socket.IO                  |
| `notifications` | Notifications over server-sent events and RabbitMQ  |
| `admin`         | Admin routes                                        |
| `health`        | Liveness and readiness                              |

## Tech stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- API: Express 5, zod, pino, Socket.IO, server-sent events
- Data: PostgreSQL 18 with Drizzle ORM, Redis 8, RabbitMQ 4.4 (optional)
- Integrations: Clerk, Stripe, Daily, ImageKit
- Tooling: pnpm workspaces with a shared catalog, Vitest and supertest, ESLint, Prettier, Husky, lint-staged, commitlint, gitleaks
- Local infrastructure: Docker Compose

## Repository structure

| Path                     | Contents                                                      |
| ------------------------ | ------------------------------------------------------------- |
| `apps/*`                 | Next.js apps                                                  |
| `services/api`           | Express API, Drizzle schema and migrations                    |
| `packages/tsconfig`      | Shared TypeScript configs                                     |
| `packages/eslint-config` | Shared ESLint configs                                         |
| `packages/ui`            | Shared UI components (placeholder)                            |
| `infra/docker`           | Docker Compose file for Postgres, Redis, RabbitMQ, Swagger UI |
| `infra/scripts`          | Test database script                                          |
| `docs`                   | Architecture, ADRs, API spec, product and design docs         |

Workspace packages are scoped as `@onemarketplace/<folder-name>`.

## Prerequisites

- Node.js 26 or newer (pinned in `.node-version`)
- pnpm 12 (the exact version is in the `packageManager` field of `package.json`)
- Docker
- gitleaks, which the pre-commit hook runs. On Windows: `winget install --id Gitleaks.Gitleaks`

## Getting started

Install dependencies. This also sets up the Git hooks through Husky.

```bash
pnpm install
```

Create the environment file. One `.env` at the repository root is the only configuration source. Set the passwords, and keep `DATABASE_URL` and `REDIS_URL` in line with them.

```bash
cp .env.example .env
```

Start Postgres, Redis, RabbitMQ and Swagger UI, and wait for their health checks:

```bash
pnpm infra:up
```

Apply the migrations and start the API:

```bash
pnpm --filter @onemarketplace/api db:migrate
pnpm --filter @onemarketplace/api dev
```

The API listens on port 4000 unless `PORT` is set. All routes are under `/api/v1`. `GET /api/v1/health` is liveness. `GET /api/v1/ready` checks Postgres and Redis and returns 503 if either is down.

To run the compiled API (this is what production does, with `NODE_ENV=production`):

```bash
pnpm --filter @onemarketplace/api build
pnpm --filter @onemarketplace/api start
```

Run an app (each has a fixed port):

```bash
pnpm --filter @onemarketplace/landing-page dev
```

| App                  | Port | Package                                |
| -------------------- | ---- | -------------------------------------- |
| Landing page         | 3000 | `@onemarketplace/landing-page`         |
| Client dashboard     | 3001 | `@onemarketplace/client-dashboard`     |
| Freelancer dashboard | 3002 | `@onemarketplace/freelancer-dashboard` |
| Agency dashboard     | 3003 | `@onemarketplace/agency-dashboard`     |
| Admin dashboard      | 3004 | `@onemarketplace/admin-dashboard`      |

`pnpm dev` starts every workspace's `dev` script in parallel.

Other infrastructure commands:

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `pnpm infra:down`  | Stop the containers                           |
| `pnpm infra:logs`  | Follow the container logs                     |
| `pnpm infra:reset` | Stop the containers and delete all their data |

Database scripts, run with `pnpm --filter @onemarketplace/api <script>`:

| Script        | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `db:generate` | Generate a migration from the modules' `*.model.ts` files |
| `db:migrate`  | Apply migrations to the database in `DATABASE_URL`        |

Docker ports are bound to `127.0.0.1` and default to Postgres 5432, Redis 6379, RabbitMQ 5672 and the RabbitMQ management UI 15672 (`http://127.0.0.1:15672`).

## Environment variables

`.env.example` lists the variables below except `SWAGGER_PORT`. Do not commit `.env`. The production list, with which variables are required, is in [`docs/architecture.md`](docs/architecture.md#production-environment).

Required to start the API and Docker:

| Variable                                            | Purpose                        |
| --------------------------------------------------- | ------------------------------ |
| `DATABASE_URL`                                      | Postgres connection URL        |
| `REDIS_URL`                                         | Redis connection URL           |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres container credentials |
| `REDIS_PASSWORD`                                    | Redis container password       |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD`                | RabbitMQ container credentials |

Docker Compose fails if its credentials are unset.

Optional. The API starts without them, and the matching feature fails only when it is used:

| Variable                                                                                    | Purpose                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `PORT`                                                                                      | API port, default 4000                                                |
| `NODE_ENV`                                                                                  | Defaults to `development`                                             |
| `TRUST_PROXY`                                                                               | Proxy hop count or subnet list; `true` is rejected                    |
| `RABBITMQ_URL`                                                                              | Enables notification events; without it they are not stored or pushed |
| `CLERK_SECRET_KEY`                                                                          | Clerk authentication                                                  |
| `STRIPE_SECRET_KEY`                                                                         | Stripe API                                                            |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECTS_WEBHOOK_SECRET`, `STRIPE_IDENTITY_WEBHOOK_SECRET` | Stripe webhook signing secrets                                        |
| `IMAGEKIT_PRIVATE_KEY`                                                                      | ImageKit uploads                                                      |
| `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`                                                     | Daily meetings and webhook verification                               |
| `ADMIN_DASHBOARD_PASSWORD`, `ADMIN_SESSION_SECRET`                                          | Admin sign-in and session signing                                     |
| `CLIENT_DASHBOARD`, `FREELANCER_DASHBOARD`, `AGENCY_DASHBOARD`, `ADMIN_DASHBOARD`           | Allowed browser origins; default to the local dev ports               |
| `TEST_DATABASE_URL`, `CREATE_TEST_DB_ADMIN_URL`                                             | Test database settings (see Testing)                                  |
| `SWAGGER_PORT`                                                                              | Swagger UI port, default 8081                                         |

Additionally required when `NODE_ENV=production`: `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECTS_WEBHOOK_SECRET`, `STRIPE_IDENTITY_WEBHOOK_SECRET`, `DAILY_API_KEY`, `DAILY_WEBHOOK_SECRET`, `IMAGEKIT_PRIVATE_KEY`, `ADMIN_DASHBOARD_PASSWORD` and `ADMIN_SESSION_SECRET` (at least 32 characters). None may contain `change-me`. At least one dashboard origin variable must also be set, and each one set must be an http(s) URL. Create the production database with a UTF-8 locale such as `en_US.utf8` (the job feed lowercases text in SQL; see ADR 0022).

## Local webhooks

Webhook routes read the raw request body and verify the signature, so the secret in `.env` must match the sender. Restart the API after changing `.env`.

| Route                            | Sender          | Secret variable                  |
| -------------------------------- | --------------- | -------------------------------- |
| `POST /api/v1/contracts/webhook` | Stripe          | `STRIPE_WEBHOOK_SECRET`          |
| `POST /api/v1/connects/webhook`  | Stripe          | `STRIPE_CONNECTS_WEBHOOK_SECRET` |
| `POST /api/v1/identity/webhook`  | Stripe Identity | `STRIPE_IDENTITY_WEBHOOK_SECRET` |
| `POST /api/v1/meetings/webhook`  | Daily           | `DAILY_WEBHOOK_SECRET`           |

With the Stripe CLI, forward each route and copy the `whsec_` secret that `stripe listen` prints into the matching variable. Run one listener per route, each in its own terminal:

```bash
stripe listen --forward-to localhost:4000/api/v1/contracts/webhook
stripe listen --forward-to localhost:4000/api/v1/connects/webhook
stripe listen --forward-to localhost:4000/api/v1/identity/webhook
```

Daily can only reach the API through a public tunnel. When `DAILY_WEBHOOK_SECRET` is unset, the API rejects every Daily delivery, so Daily webhooks are skipped in local development.

## API documentation

The API contract is OpenAPI 3.1 in `docs/api/openapi.json`. It is generated from the route schemas and committed, and CI fails if it drifts.

Swagger UI is part of the Compose stack. After `pnpm infra:up`, open `http://127.0.0.1:8081`, or the port in `SWAGGER_PORT`.

Regenerate the spec after changing routes or schemas:

```bash
pnpm -C services/api run openapi:generate
```

## Testing and quality gates

CI runs these commands:

| Check               | Command                                |
| ------------------- | -------------------------------------- |
| Format, lint, types | `pnpm check`                           |
| Format only         | `pnpm format:check`                    |
| Lint only           | `pnpm lint`                            |
| Typecheck only      | `pnpm typecheck`                       |
| Build               | `pnpm -r build`                        |
| Production audit    | `pnpm audit --prod --audit-level high` |

`pnpm format` rewrites files with Prettier.

API tests need Docker Postgres and Redis. They use a separate database ending in `_test` and refuse to run unless the URLs point at localhost.

```bash
pnpm infra:up
pnpm --filter @onemarketplace/api db:test:setup
pnpm --filter @onemarketplace/api test
```

`pnpm test:quiet` runs the API suite with minimal output. `db:test:setup` creates the test database and applies the migrations. The RabbitMQ integration test runs when `RABBITMQ_URL` points at the local broker.

Git hooks: `pre-commit` runs gitleaks on staged changes and then lint-staged (ESLint and Prettier). `commit-msg` enforces conventional commit messages, for example `feat: add job feed`.

## Architecture and conventions

- [`docs/architecture.md`](docs/architecture.md): how the apps, API modules, database and local infrastructure fit together.
- [`docs/frontend-integration-notes.md`](docs/frontend-integration-notes.md): checklist for the frontend apps before they call the API.
- [`docs/adding-an-api-module.md`](docs/adding-an-api-module.md): checklist for a new API module or route.
- [`docs/decisions/`](docs/decisions/): architecture decision records.
- [`docs/ci.md`](docs/ci.md): CI jobs and how to run each check locally.
- [`docs/product.md`](docs/product.md) and [`docs/design-system.md`](docs/design-system.md): product flows and UI conventions.
- [`AGENTS.md`](AGENTS.md): repository rules for contributors and coding agents.

## CI

One GitHub Actions workflow, `.github/workflows/ci.yml`, runs on pull requests and pushes to `main`. Its jobs are `check`, `build`, `api-test`, `gitleaks`, `audit`, `dependency-review`, `codeql`, `workflow-lint` and `compose-validate`. `ci-pass` aggregates the blocking jobs and is the only required status check. `audit` is informational. A weekly scheduled run executes only `audit` and `codeql`. Dependabot opens weekly updates for npm, GitHub Actions and Docker Compose. Details are in [`docs/ci.md`](docs/ci.md).
