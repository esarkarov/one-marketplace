# OneMarketplace Application

A freelancing marketplace built as a pnpm monorepo. Clients post jobs, freelancers and agencies apply, and the platform handles proposals, contracts, milestones and payments.

## Status

Early stage. The monorepo tooling and five Next.js front-end apps are in place. Backend services, the database layer, messaging and payments are planned and not yet in the repository.

## Repository layout

```
apps/
  landing-page/            public marketing site
  client-dashboard/        client workspace
  freelancer-dashboard/    freelancer workspace
  agency-dashboard/        agency workspace
  admin-dashboard/         admin console
services/                  backend services, one folder per service (planned)
packages/
  tsconfig/                shared TypeScript configs (@onemarketplace/tsconfig)
  eslint-config/           shared ESLint configs (@onemarketplace/eslint-config)
  ui/                      shared UI components (placeholder)
```

Workspace packages are scoped as `@onemarketplace/<folder-name>`.

## Tech stack

Current:

- Next.js, React, TypeScript, Tailwind CSS
- pnpm workspaces with a shared dependency catalog
- ESLint, Prettier, Husky, lint-staged, commitlint, gitleaks
- GitHub Actions and Dependabot

Planned, following the tutorial:

- Express.js, PostgreSQL, Drizzle ORM
- Redis, NATS JetStream, Docker
- Server-sent events and Socket.IO
- Clerk (authentication), Stripe (payments), ImageKit (file storage)

## Prerequisites

- Node.js 26 (pinned in `.node-version`). A version manager such as fnm is recommended.
- pnpm 12 (the exact version is set in the `packageManager` field of `package.json`)
- gitleaks, required by the pre-commit hook. On Windows: `winget install --id Gitleaks.Gitleaks`

## Getting started

```bash
git clone https://github.com/esarkarov/one-marketplace.git
cd one-marketplace
pnpm install
```

`pnpm install` also sets up the Git hooks through Husky.

Run a single app:

```bash
pnpm --filter @onemarketplace/landing-page dev
```

Replace `landing-page` with `client-dashboard`, `freelancer-dashboard`, `agency-dashboard` or `admin-dashboard`. Next.js uses port 3000 by default, so pass a different port (`pnpm --filter <package> dev -- -p 3001`) when running several apps at once.

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

1. Local infrastructure: Docker Compose with PostgreSQL, Redis and NATS JetStream
2. Shared packages for the database schema, event contracts and validators
3. First backend service with authentication
4. Features, one vertical slice at a time: jobs, proposals, contracts and milestones, payments, real-time messaging and notifications
