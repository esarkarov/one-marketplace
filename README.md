# OneMarketplace Application

A freelancing marketplace built as a pnpm monorepo. Clients post jobs, freelancers and agencies apply, and the platform handles proposals, contracts, milestones and payments.

## Status

Early stage. The monorepo tooling, five Next.js front-end apps and the API in `services/api` are in place. The apps still use mock data and do not call the API yet.

## Repository layout

```
apps/
  landing-page/            public marketing site
  client-dashboard/        client workspace
  freelancer-dashboard/    freelancer workspace
  agency-dashboard/        agency workspace
  admin-dashboard/         admin console
services/
  api/                     Express API: modules, Drizzle schema and migrations
infra/
  docker/                  local Postgres and Redis (Docker Compose)
packages/
  tsconfig/                shared TypeScript configs (@onemarketplace/tsconfig)
  eslint-config/           shared ESLint configs (@onemarketplace/eslint-config)
  ui/                      shared UI components (placeholder)
```

Workspace packages are scoped as `@onemarketplace/<folder-name>`.

## Tech stack

- Next.js, React, TypeScript, Tailwind CSS
- Express 5, PostgreSQL, Drizzle ORM, Redis, optional NATS JetStream, Docker
- Server-sent events and Socket.IO
- Clerk (authentication), Stripe (payments), Daily (meetings), ImageKit (file storage)
- pnpm workspaces with a shared dependency catalog
- Vitest and supertest for API tests
- ESLint, Prettier, Husky, lint-staged, commitlint, gitleaks
- GitHub Actions and Dependabot

## Prerequisites

- Node.js 26 (pinned in `.node-version`). A version manager such as fnm is recommended.
- pnpm 12 (the exact version is set in the `packageManager` field of `package.json`)
- Docker, for local Postgres and Redis
- gitleaks, required by the pre-commit hook. On Windows: `winget install --id Gitleaks.Gitleaks`

## Getting started

```bash
git clone https://github.com/esarkarov/one-marketplace.git
cd one-marketplace
pnpm install
```

`pnpm install` also sets up the Git hooks through Husky.

### Ports

| Service              | Port | Package                                |
| -------------------- | ---- | -------------------------------------- |
| Landing page         | 3000 | `@onemarketplace/landing-page`         |
| Client dashboard     | 3001 | `@onemarketplace/client-dashboard`     |
| Freelancer dashboard | 3002 | `@onemarketplace/freelancer-dashboard` |
| Agency dashboard     | 3003 | `@onemarketplace/agency-dashboard`     |
| Admin dashboard      | 3004 | `@onemarketplace/admin-dashboard`      |
| API                  | 4000 | `@onemarketplace/api`                  |
| Postgres (Docker)    | 5432 |                                        |
| Redis (Docker)       | 6379 |                                        |

Each app has a fixed dev port, so they can run side by side. The API only accepts browser requests from the four dashboards (ports 3001 to 3004, or the `*_DASHBOARD` variables in `.env`); the landing page is not allowed.

### Run an app

```bash
pnpm --filter @onemarketplace/landing-page dev
```

Replace `landing-page` with `client-dashboard`, `freelancer-dashboard`, `agency-dashboard` or `admin-dashboard`.

### Run the API

One `.env` file at the repository root is the only source of configuration. The API scripts load it.

```bash
cp .env.example .env        # then set the passwords; DATABASE_URL and REDIS_URL must match them
pnpm infra:up               # start Postgres and Redis in Docker
pnpm --filter @onemarketplace/api db:migrate
pnpm --filter @onemarketplace/api dev
```

Postgres and Redis are the only services needed to start. Clerk, Stripe, ImageKit, Daily, NATS and the log service are optional; the matching features fail only when called. Without `NATS_URL`, notifications are not stored or pushed.

- `GET /api/v1/health` is liveness. `GET /api/v1/ready` checks Postgres and Redis and returns 503 if either is down.
- `pnpm infra:down` stops the containers. `pnpm infra:reset` deletes the database and Redis data.

### Database commands

```bash
pnpm --filter @onemarketplace/api db:generate    # create a migration from src/database/schema.ts
pnpm --filter @onemarketplace/api db:migrate     # apply migrations to the database in DATABASE_URL
```

Migrations are committed and never edited after they are merged.

### API tests

```bash
pnpm infra:up
pnpm --filter @onemarketplace/api test
```

The tests need the Docker Postgres and Redis running and refuse to start unless `DATABASE_URL` and `REDIS_URL` point to localhost.

## Scripts

Run from the repository root:

| Command                       | What it does                                  |
| ----------------------------- | --------------------------------------------- |
| `pnpm format`                 | Format the repository with Prettier           |
| `pnpm format:check`           | Check formatting without changing files       |
| `pnpm -r --no-bail lint`      | Lint every workspace                          |
| `pnpm -r --no-bail typecheck` | Type-check every workspace                    |
| `pnpm -r build`               | Build every workspace                         |
| `pnpm check`                  | Run format check, lint and typecheck in order |

## Quality checks

Commit-time hooks (Husky):

- `pre-commit`: gitleaks scans staged changes for secrets, then lint-staged runs ESLint and Prettier on staged files.
- `commit-msg`: commitlint enforces conventional commit messages, for example `feat: add job feed` or `fix: handle empty proposal list`.

Hooks can be bypassed locally, so CI repeats the checks. The GitHub Actions workflow runs `pnpm check`, builds all apps, and scans the full Git history with gitleaks on every pull request and push to `main`.

Dependabot opens weekly pull requests for npm packages and GitHub Actions, with a short cooldown before newly published versions are proposed.

## Conventions

- Folders and files use kebab-case.
- Shared dependency versions live in the catalog in `pnpm-workspace.yaml`. Use `catalog:` in a workspace `package.json` for shared dependencies.
- `typescript` is aliased to `@typescript/typescript6` so typescript-eslint keeps working, while `tsc` comes from `@typescript/native` (TypeScript 7). Keep both until typescript-eslint supports TypeScript 7.
- Do not set `turbopack.root` to `process.cwd()` in a Next.js config. Leave root detection to Next.js.
- Agent instructions for this repository are in `AGENTS.md`.

## Roadmap

1. API hardening: request validation with zod, structured logging with pino, tests for every module
2. NATS JetStream in local Docker Compose
3. Connect the dashboards to the API, one vertical slice at a time: jobs, proposals, contracts and milestones, payments, real-time messaging and notifications
