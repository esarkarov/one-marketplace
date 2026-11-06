# OneMarketplace

pnpm monorepo for a freelancing marketplace.

## Layout

- apps/\*: Next.js dashboards (landing-page, client-dashboard, freelancer-dashboard, agency-dashboard, admin-dashboard)
- services/api: Express modular monolith with one module per domain (planned)
- packages/\*: shared code, scoped as `@onemarketplace/<folder-name>`
- infra/docker: local Postgres and Redis

## Docs

- `docs/product.md`: roles and flows as the apps show them. Read it for product work.
- `docs/design-system.md`: tokens and component conventions. Read it for UI work.
- `docs/decisions/`: architecture decision records.
- Nested `AGENTS.md` files in `services/api`, `packages/db` and `infra` add folder-specific rules.

@docs/architecture.md

## Tooling

- Node 26 (pinned in `.node-version`) and pnpm 12. Use pnpm only, never npm or yarn.
- Shared dependency versions live in the catalog in `pnpm-workspace.yaml`. Use `catalog:` in `package.json` for shared dependencies.
- `typescript` is an alias for `@typescript/typescript6` so typescript-eslint keeps working. `tsc` comes from `@typescript/native` (TypeScript 7). Do not replace either.
- Next.js apps: read the app's own `AGENTS.md` before writing code.

## Commands

- `pnpm install`
- `pnpm -r --no-bail lint`, `typecheck`, `build`
- `pnpm --filter @onemarketplace/<name> <script>` for a single package

## Conventions

- kebab-case for folders and files.
- Conventional commit messages.
- No unnecessary comments in source code.
- Never set `turbopack.root` to `process.cwd()` in a Next config. Leave root detection to Next.
- Ask before editing application source files.
