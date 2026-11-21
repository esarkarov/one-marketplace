---
name: adr
description: Write a new architecture decision record or update an existing one in docs/decisions, in this repo's format. Use when a decision, rule or behavior change needs recording.
---

# adr

ADRs record the state at their date; do not rewrite history. Format and examples: `references/format.md`.

1. List the folder (`ls docs/decisions`) and Grep for the topic. There is no index file. If an ADR already covers it, add a dated `## Update YYYY-MM-DD: <topic>` section to that ADR instead of a new file.
2. New ADR: next number, file `docs/decisions/NNNN-kebab-title.md`, heading `# NNNN: Title`, then `Status:` line, `## Context`, `## Decision`, `## Consequences`.
3. Link both ways: mention superseded or related ADRs by number, and add the ADR number where `docs/architecture.md` or `services/api/AGENTS.md` states the rule (summary plus number, not prose).
4. Keep it factual: what changed, why, what enforces it (test or lint name), what is still open. No comments about code style, no marketing.
5. Run `pnpm exec prettier --check --end-of-line auto <file>`; report the new file and the docs you updated.
