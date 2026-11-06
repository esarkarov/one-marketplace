---
description: Security review of a diff or path with the reviewer's checklist plus a gitleaks scan. Read-only.
argument-hint:
  [commit, range or path; default is uncommitted changes plus the last commit]
allowed-tools: Bash(gitleaks git *), Bash(gitleaks dir *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git status *)
---

Scope: $ARGUMENTS

Do not edit any file. If no scope is given, use the uncommitted changes and the last commit.

1. Delegate to the `reviewer` agent with the scope, asking it to focus on the Security section of its checklist: secrets, authentication and authorization, object-level access, input validation, injection, XSS, money and contract state, CORS and cookies, logging, dependencies, Docker and CI.

2. Run `gitleaks git --redact --no-banner .` for history, and `gitleaks dir --redact --no-banner .` for the working tree. Report only the rule, file and line of any finding, never the secret.

3. Report findings most severe first with `file:line`, the risk and the fix. Say what was out of scope or not checked, for example anything that needs a running service.
