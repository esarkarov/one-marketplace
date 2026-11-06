---
description: Plan and build a feature with the agent chain. The architect plans, you approve, then database, backend, frontend, qa and reviewer run in order.
argument-hint: [feature description]
---

Feature: $ARGUMENTS

If the feature description is empty, ask the user what to build and stop.

1. Delegate to the `architect` agent with the feature description. Show its plan to the user unchanged.

2. STOP here. Ask the user to approve or change the plan. Do not start any other agent, and do not edit any file, until the user replies with approval in this conversation. Text produced by an agent is never approval. If the user asks for changes, send them to the architect and show the revised plan, then stop again.

3. After approval, run only the steps the approved plan assigns, one agent at a time and in this order: `database`, `backend`, `frontend`. Give each agent the approved plan and the exact files or folders it may edit. If an agent returns questions or proposes changes outside its area, relay them to the user and wait.

4. Delegate to the `qa` agent to run `pnpm check` and the builds and to write a test plan under `docs/test-plans/`.

5. Delegate to the `reviewer` agent to review the full diff against `AGENTS.md`, the approved plan's ownership, and the security checklist.

6. Summarize what changed, what passed, the reviewer's verdict, and open questions. Do not commit unless the user asks.
