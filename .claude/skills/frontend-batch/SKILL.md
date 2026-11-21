---
name: frontend-batch
description: Procedure for one sub-batch of migrating a Next.js app in apps/* to the typed api-client and web-core per docs/frontend-migration-plan.md. Use for app migration work, not for backend or one-off UI tweaks.
---

# frontend-batch

Standing rules and tiers are in `AGENTS.md`.

1. Read `docs/frontend-migration-plan.md` (the batch, its Status and "result" sections), `docs/frontend-integration-notes.md` for the endpoints in scope, the app's own `AGENTS.md`, and `packages/api-client/README.md` and `packages/web-core/README.md`.
2. Inventory with the `explorer` agent: every API call, money field, list envelope, Clerk-id use and status enum in the sub-batch files. Output: a table of file, old shape, new shape. Ask before editing application source.
3. Implement with the `frontend` agent, only the files in the approved inventory: api-client calls, `*Cents` and `formatCents`, `{ results, hasMore | nextCursor }`, error `code` and `requestId`, role and scope, public ids from `useAccount`. Details: `references/checklist.md`.
4. Tier 1 after each unit: affected tests, `pnpm --filter @onemarketplace/<app> typecheck`, eslint on touched files (`pnpm --filter @onemarketplace/<app> exec eslint <files>`).
5. Docs: add a "Batch N result" and a Status line to `docs/frontend-migration-plan.md`, with a manual QA checklist for the owner and known limitations. Update `docs/frontend-integration-notes.md` if you found a contract surprise.
6. Last sub-batch of an app only: remove the app from `unmigratedApps` in `packages/eslint-config/next.mjs` (needs the owner's approval, it is infra), reach zero warnings for the five rules, run Tier 2 (`pnpm check`, `pnpm --filter @onemarketplace/<app> build` with dummy env) and one `reviewer` pass.
7. Compact report (format in `AGENTS.md`), then `/commit-plan`. Never commit.
