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

## Agent setup

Configuration lives in `.claude/` and `.mcp.json`.

Agents (`.claude/agents/`), each owning one area:

- `architect`: plans, read-only.
- `frontend`: `apps/*`, `packages/ui`.
- `design-ux`: UX and accessibility review, read-only.
- `backend`: `services/api`.
- `database`: `packages/db`.
- `infra`: `infra/`, `.github/`, `.husky/`, `.claude/`, root config, shared tsconfig and eslint-config.
- `qa`: runs checks, writes test plans under `docs/test-plans/`.
- `reviewer`: reviews diffs against this file and a security checklist, read-only.

Implementer agents edit only files named in an approved plan or request, and return questions to the main session otherwise.

Commands (`.claude/commands/`):

- `/feature`: architect plans, you approve, then database, backend, frontend, qa and reviewer.
- `/db-change`: schema change in `packages/db` with a reviewed migration.
- `/ui-review`: design-ux plus the two UI skills, read-only.
- `/security-audit`: reviewer security pass plus gitleaks, read-only.
- `/check`: format check, lint, typecheck and builds.

Skills (`.claude/skills/`, vendored and pinned in `skills-lock.json`):

- `vercel-react-best-practices`
- `web-design-guidelines`: guidelines are a pinned local copy, see its `UPSTREAM.md`.

MCP servers (`.mcp.json`, exact versions, approve each on first use):

- `context7`: library documentation.
- `playwright`: browser automation, used by `design-ux` on a running app.

Guards in `.claude/settings.json`: `.env*` (except `.env.example`) and `pnpm-lock.yaml` cannot be edited, and edits to `.claude/settings.json` and `.claude/hooks/` ask first. Update a vendored skill by re-reviewing it, not by editing it in place.
