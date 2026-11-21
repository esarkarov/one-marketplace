---
description: Print, never run, the narrow git add and single-line git commit commands for the current changes.
allowed-tools: Bash(node .claude/scripts/commit-plan.mjs), Bash(git status *), Bash(git diff *), Bash(git log *)
---

1. Run `node .claude/scripts/commit-plan.mjs`. It groups the changed files by concern and prints a `git add -- <paths>` and a `git commit` line per group. Nothing is executed.
2. Read `git diff HEAD --stat` and, per group, the diff itself. Replace `<subject>` with a conventional-commit subject (imperative, no period, whole header at most 100 characters) and `<body ...>` with a body, or drop the body `-m`. Body lines at most 100 characters. Keep the trailer `-m`.
3. Print the final commands for Windows (cmd or PowerShell compatible: one line each, double quotes, no backslash continuations). One concern per commit; list groups in the order they should be committed.
4. Add: the gitleaks and `--no-verify` variant if the pre-commit hook would block (the script prints it and whether `gitleaks` is installed), and a note for any file that needs its own commit (`pnpm-lock.yaml`, generated contract files, migrations).
5. Never run `git add` or `git commit`. The user runs them.
