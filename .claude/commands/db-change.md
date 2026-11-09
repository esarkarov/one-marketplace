---
description: Make a database schema change in services/api with a generated migration against local Docker, then review it.
argument-hint: [describe the schema change]
---

Schema change: $ARGUMENTS

If the description is empty, ask the user what to change and stop.

1. Delegate to the `database` agent with the description. It may edit only `services/api/src/database/`, `services/api/drizzle/` and `services/api/drizzle.config.ts`. It must describe the data impact first and stop for approval before any destructive change. Migrations run only against the local Docker database, never Neon or a remote database.

2. Show the user the schema diff and the generated migration. If the change affects API modules or other areas, list them as follow-ups for the `backend` agent; do not edit them.

3. Delegate to the `reviewer` agent to review the diff, focusing on migration safety, naming conventions and module boundaries.

4. Report the files changed, the migration result against the local Docker database, and open questions. Do not commit unless the user asks.
