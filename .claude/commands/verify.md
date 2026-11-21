---
description: Detect the changed areas with read-only git and run the tier-1 checks through the test-runner agent.
allowed-tools: Bash(node .claude/scripts/changed-areas.mjs), Bash(git status *), Bash(git diff *)
---

1. Run `node .claude/scripts/changed-areas.mjs`. It reads `git diff --name-only HEAD` and untracked files, and prints the changed areas and the tier-1 commands for them (module tests, typecheck, eslint on touched files, prettier check, openapi drift when routes or schemas changed).
2. If it lists no commands, say there is nothing to verify and stop.
3. Hand the listed commands, unchanged and in order, to the `test-runner` agent. Do not add the full suite; this is tier 1 (`AGENTS.md`). If a command needs the local test database and it is missing, report `pnpm --filter @onemarketplace/api db:test:setup` as the fix.
4. Report one line per command (PASS or FAIL with counts), then the first error of each failure with file and line. For the openapi drift commands, compare the two `sha256sum` lines and say whether the contract changed. Fix nothing and commit nothing.

Tier 2 (full suite or `pnpm check`, production build, reviewer) is not part of this command.
