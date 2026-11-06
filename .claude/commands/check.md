---
description: Run the repository checks (format check, lint, typecheck) and builds, and summarize the result.
allowed-tools: Bash(pnpm check *), Bash(pnpm -r --no-bail build)
---

Run `pnpm check`, then `pnpm -r --no-bail build`. Run the build even if the check fails.

Report each command with pass or fail. For failures give the workspace, file, line and message. Lint warnings that already exist are not failures; say how many warnings each app reports. Do not fix anything.
