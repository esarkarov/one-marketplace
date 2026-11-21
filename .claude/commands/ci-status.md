---
description: Show the latest CI run for the current branch, trimmed logs of failing jobs and open code-scanning alerts, using read-only gh.
allowed-tools: Bash(gh auth status), Bash(gh run list *), Bash(gh run view *), Bash(gh api *code-scanning/alerts*), Bash(git branch --show-current)
---

Read only. Never log in, rerun, cancel or comment.

1. `gh auth status`. If it fails or `gh` is not installed, say so in one line ("gh is not authenticated; run gh auth login yourself") and stop.
2. `git branch --show-current`, then `gh run list --branch <branch> --limit 1 --json databaseId,name,status,conclusion,headSha,url`. No run: say so.
3. `gh run view <databaseId> --json jobs --jq '.jobs[] | "\(.conclusion // .status)\t\(.name)"'`: one line per job, failures first.
4. For each failed job: `gh run view <databaseId> --log-failed` limited to that job, trimmed to the last 40 lines per job (`| tail -40` is fine). Quote the first error only.
5. Open alerts: `gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open" --jq '.[] | "\(.rule.id)\t\(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)\t\(.rule.severity)"'`. If the API answers 403 or 404, say code scanning is not readable with this token.
6. Report in at most 30 lines. For a failing job suggest the `ci-triage` skill; do not fix anything.
