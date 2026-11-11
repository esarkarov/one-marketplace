# OneMarketplace

pnpm monorepo for a freelancing marketplace.

## Layout

- apps/\*: Next.js dashboards (landing-page, client-dashboard, freelancer-dashboard, agency-dashboard, admin-dashboard)
- services/api: Express 5 modular monolith with one module per domain, including the Drizzle schema and migrations. Tutorial code under `services/` is being migrated into it (`docs/decisions/0003-api-migration.md`).
- packages/\*: shared code, scoped as `@onemarketplace/<folder-name>`
- infra/docker: local Postgres and Redis

## Docs

- `docs/product.md`: roles and flows as the apps show them. Read it for product work.
- `docs/design-system.md`: tokens and component conventions. Read it for UI work.
- `docs/decisions/`: architecture decision records.
- Nested `AGENTS.md` files in `services/api` and `infra` add folder-specific rules.

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

## Agent setup

Agents, commands and skills live in `.claude/` (each file's frontmatter says what it owns), MCP servers in `.mcp.json`. Implementer agents edit only files named in an approved plan or request and return questions to the main session otherwise. Slash commands: `/feature`, `/db-change`, `/ui-review`, `/security-audit`, `/check`. Skills are vendored and pinned in `skills-lock.json`; update one by re-reviewing it, not by editing it in place.

Guards in `.claude/settings.json`: `.env*` (except `.env.example`) and `pnpm-lock.yaml` cannot be changed with the Edit, Write or NotebookEdit tools, and edits to `.claude/settings.json` and `.claude/hooks/` ask first. MCP servers are pinned to exact versions and approved on first use. `playwright` is disabled by default; enable it through `/mcp` before UI review.

## Token and model policy

- Models: architect and reviewer use opus; backend, database, frontend, qa, design-ux and infra use sonnet; `mechanical` uses haiku for renames, docs and lint fixes.
- Start a fresh session for each stage of a feature.
- Use Grep and ranged Read instead of reading whole files, and do not re-read a file already read.
- After each step run only scoped checks (`pnpm --filter <pkg> ...`, `pnpm --filter @onemarketplace/api test:quiet <path>`); run the full suite once at the end of a step group.
- Prefer quiet output: `pnpm test:quiet`, `pnpm --silent`.
- At most one reviewer pass per change.
