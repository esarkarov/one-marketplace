---
name: ci-triage
description: Diagnose a failing CI job or a code-scanning alert by reading the workflow, reproducing the same commands locally and reporting cause and fix. Use when a CI check or CodeQL alert fails.
---

# ci-triage

Read-only diagnosis. Never edit `.github/workflows` and never rerun or cancel runs.

1. Identify the failing job: `/ci-status` (needs authenticated `gh`) or the job name the user gives.
2. Read the job in `.github/workflows/ci.yml` and the matching section of `docs/ci.md`. Copy the exact commands; table in `references/jobs.md`.
3. Reproduce locally with those commands through the `test-runner` agent. Differences to expect: CI checks out LF files (`prettier --check` locally needs `--end-of-line auto`), uses `--frozen-lockfile`, and runs `api-test` with Postgres, Redis and RabbitMQ.
4. For a code-scanning alert, read the cited file and line, the rule id, and decide: real issue, false positive, or test-only code (see `.github/codeql/codeql-config.yml`).
5. Report: failing job, first error, local reproduction result (same or different), cause, proposed fix with file and line, who owns it (`reviewer` ownership map). If you cannot reproduce locally, say what differs and stop.
