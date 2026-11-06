---
description: Make a database schema change in packages/db with a generated migration, then review it.
argument-hint: [describe the schema change]
---

Schema change: $ARGUMENTS

If the description is empty, ask the user what to change and stop.

1. Delegate to the `database` agent with the description. Name `packages/db` as the only area it may edit. It must describe the data impact first and stop for approval before any destructive change.

2. Show the user the schema diff and the generated migration. If the change affects API code or other areas, list them as follow-ups; do not edit them.

3. Delegate to the `reviewer` agent to review the diff, focusing on migration safety, naming conventions and module boundaries.

4. Report the files changed, the migration result against the local Docker database, and open questions. Do not commit unless the user asks.
