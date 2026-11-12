---
description: Run the repository checks (format check, lint, typecheck), builds and the API gates (tests, OpenAPI, schema drift, boundaries), and summarize the result.
allowed-tools: Bash(pnpm check *), Bash(pnpm -r --no-bail build), Bash(pnpm --filter @onemarketplace/api exec vitest run *), Bash(pnpm --filter @onemarketplace/api openapi:generate), Bash(git diff --exit-code -- docs/api/openapi.json), Bash(pnpm --filter @onemarketplace/api db:generate), Bash(git status --short services/api/drizzle)
---

Run `pnpm check`, then `pnpm -r --no-bail build`. Run the build even if the check fails.

Then run the API gates, each even if an earlier one failed:

1. `pnpm --filter @onemarketplace/api exec vitest run --reporter=dot`: the full suite, which includes the architecture test (`src/test/architecture`, import boundaries, layers and cycles). It needs the local Docker test database; report a missing database instead of skipping. Skipped tests count as a failure.
2. `pnpm --filter @onemarketplace/api openapi:generate`, then `git diff --exit-code -- docs/api/openapi.json`. A diff means the spec is stale.
3. `pnpm --filter @onemarketplace/api db:generate` must print "No schema changes". If it does not, run `git status --short services/api/drizzle`, report the new files and stop; never keep or edit a migration here, schema changes go through `/db-change`.

Report each command with pass or fail. For failures give the workspace, file, line and message. Lint warnings that already exist are not failures; say how many warnings each app reports. Do not fix anything.
