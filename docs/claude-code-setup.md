# Claude Code setup

What the project-level tooling in `.claude/` does and how to use it. The rules themselves are in [`AGENTS.md`](../AGENTS.md).

## What is installed

- Hooks (Node `.mjs`, `.claude/hooks/`): `bash-guard` blocks git and gh writes, `rm`, npm, npx, yarn, `services/api/scripts/*.ts` and `.env` access (`.env.example` templates are allowed); `gh` is limited to `run list|view`, `pr view|list|checks`, `auth status` and plain GET `gh api` (no `-X`/`--method` other than GET, no `-f`/`-F`/`--field`/`--raw-field`/`--input`, no `graphql`); `protect-generated` blocks edits to `docs/api/openapi.json`, `packages/api-client/src/generated/*` and tracked migration files; `protect-files` blocks reading or editing `.env*` other than `.env.example`, and editing `pnpm-lock.yaml`; `format-edited` runs prettier (`--end-of-line auto`) on the file just edited; `trim-test-output` rewrites a plain test command so only failures and the summary come back. Bypass the trimming with `CLAUDE_FULL_TEST_OUTPUT=1` (as an environment variable or a command prefix). Check them all with `node .claude/hooks/selftest.mjs`.
- Agents: `explorer` (haiku, read only, 40 lines), `test-runner` (haiku, failures and counts), `reviewer` (sonnet, read only), plus the existing architect, backend, database, frontend, infra, qa, design-ux and mechanical.
- Skills: `api-change`, `frontend-batch`, `adr`, `ci-triage` (project skills, not in `skills-lock.json`, which pins vendored skills only).
- Commands: `/verify`, `/commit-plan`, `/ci-status` (new), `/check`, `/feature`, `/db-change`, `/ui-review`, `/security-audit`.
- `.claude/settings.local.json` is gitignored; personal permissions go there.

## Daily commands

- `/usage`: plan usage and limits. Look before starting a long stage.
- `/context`: what fills the context window. If skills, MCP tools or old file reads dominate, `/clear` or start a new stage.
- `/clear`: new conversation, same project settings. Use between stages (plan, implement, review) as the token policy says.
- `/effort`: sets the reasoning effort for the session. Raise it for design and review, lower it for mechanical edits.
- Plan mode (shift+tab, or ask for a plan): the agent reads and plans but edits nothing. Use it for every non-trivial slice, approve the file list, then leave plan mode.
- `/verify`: tier-1 checks for what changed (`.claude/scripts/changed-areas.mjs` picks module tests, typecheck, eslint on touched files, prettier check, openapi drift). Run it after each unit of work.
- `/commit-plan`: prints the `git add` and `git commit` commands per concern. You run them. If the pre-commit gitleaks hook blocks, it prints the scan command and the `--no-verify` fallback.
- `/ci-status`: latest CI run for the branch, failing job logs, open code-scanning alerts. Needs `gh` installed and logged in (`gh auth login`, done by you).

## Which model and effort

| Work                                | Model and effort                                            | Notes                                                                             |
| ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Backend slice (route, money, state) | Plan with opus, high effort; implement with sonnet, medium  | Money, ordering and security logic: add mutation checks, review with the reviewer |
| Frontend sub-batch                  | Sonnet, medium; plan from `docs/frontend-migration-plan.md` | Explorer inventory first, one app per session                                     |
| Review                              | Sonnet (the `reviewer` agent), high; one pass per change    | Run after tier 2, on the working-tree diff                                        |
| Exploration, "where is X"           | Haiku via `explorer`                                        | Returns a short list, keeps file dumps out of the main context                    |
| Running tests and checks            | Haiku via `test-runner`                                     | Returns counts and failures only                                                  |
| Renames, docs wording, lint fixes   | Haiku via `mechanical`, low effort                          | Not for logic, money, auth or CI files                                            |
| CI failure                          | Sonnet, medium, `ci-triage` skill                           | Reproduce the job's commands first                                                |

## Per stage

1. New session, plan mode, state the slice and the approved files.
2. Implement with the matching skill (`api-change` or `frontend-batch`). `/verify` after each unit.
3. Tier 2 at the end: `pnpm check`, full API suite or app build, `reviewer`.
4. `/commit-plan`, run the commands yourself, `/ci-status` after the push.

## Limits to know

- `bash-guard` reads the command text. `grep` and `echo` arguments are not treated as git commands, but any other command that spells out a blocked word (a script that calls `rm`, for example) is blocked; use the dedicated Read, Grep and Glob tools instead.
- Applied migration files, including `meta/_journal.json` and snapshots, are blocked for the Edit and Write tools. drizzle-kit writes them through `/db-change`, which the hook does not touch.
- `gh` and the TypeScript code-intelligence plugin (`typescript-lsp` in the `claude-plugins-official` marketplace) are not installed by this setup; install them yourself if you want them.
