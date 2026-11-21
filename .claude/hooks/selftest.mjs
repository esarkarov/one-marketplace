import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, "..", "..");

const run = (hook, input) =>
  spawnSync(process.execPath, [path.join(here, hook)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });

const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path) => ({ tool_name: "Edit", tool_input: { file_path } });

const read = (file_path) => ({ tool_name: "Read", tool_input: { file_path } });

const guard = (command, expected) => [
  "bash-guard.mjs",
  bash(command),
  expected,
];

const cases = [
  guard("gh pr view 12", 0),
  guard("gh pr list --state open", 0),
  guard("gh pr checks 12", 0),
  guard("gh run view 123 --log-failed", 0),
  guard("gh auth status", 0),
  guard("gh api --method GET repos/o/r/code-scanning/alerts", 0),
  guard("gh run watch 123", 2),
  guard("gh run rerun 123", 2),
  guard("gh pr diff 12", 2),
  guard("gh pr status", 2),
  guard("gh pr merge 12", 2),
  guard("gh issue list", 2),
  guard("gh issue view 3", 2),
  guard("gh repo view", 2),
  guard("gh workflow list", 2),
  guard("gh workflow run ci.yml", 2),
  guard("gh release list", 2),
  guard("gh auth login", 2),
  guard("gh api repos/o/r/issues --method DELETE", 2),
  guard("gh api repos/o/r/issues --method=PATCH", 2),
  guard("gh api repos/o/r/issues -XPOST", 2),
  guard("gh api repos/o/r/issues -X put", 2),
  guard("gh api repos/o/r/issues -F title=x", 2),
  guard("gh api repos/o/r/issues -ftitle=x", 2),
  guard("gh api repos/o/r/issues --field title=x", 2),
  guard("gh api repos/o/r/issues --raw-field title=x", 2),
  guard("gh api repos/o/r/issues --input body.json", 2),
  guard("gh api graphql", 2),
  guard("gh api graphql -f query=x", 2),
  guard("gh api -H Accept:x graphql", 2),
  guard("cat .env.example", 0),
  guard("cat apps/client-dashboard/.env.example", 0),
  guard("ls services/api/.env.example", 0),
  guard("cat .env.example.local", 2),
  guard("cat .env.production", 2),
  guard("cat apps/client-dashboard/.env.local", 2),
  guard("grep KEY services/api/.env.test.local", 2),
  ["bash-guard.mjs", bash("git status --short"), 0],
  ["bash-guard.mjs", bash("git -C . log --oneline -5"), 0],
  ["bash-guard.mjs", bash("git branch --show-current"), 0],
  ["bash-guard.mjs", bash("git diff --stat && pnpm check"), 0],
  ["bash-guard.mjs", bash("git stash list"), 0],
  ["bash-guard.mjs", bash('rg "git commit" docs'), 0],
  [
    "bash-guard.mjs",
    bash("pnpm --filter @onemarketplace/api test:quiet src/modules/jobs"),
    0,
  ],
  ["bash-guard.mjs", bash("gh run list --limit 3"), 0],
  [
    "bash-guard.mjs",
    bash("gh api repos/o/r/code-scanning/alerts?state=open"),
    0,
  ],
  [
    "bash-guard.mjs",
    bash("pnpm exec eslint services/api/scripts/backfill-search-text.ts"),
    0,
  ],
  [
    "bash-guard.mjs",
    bash("gitleaks git --config .gitleaks.toml --redact -v --no-banner ."),
    0,
  ],
  ["bash-guard.mjs", bash("node .claude/scripts/commit-plan.mjs"), 0],
  ["bash-guard.mjs", bash("git add ."), 2],
  ["bash-guard.mjs", bash('git commit -m "x"'), 2],
  ["bash-guard.mjs", bash("pnpm check && git push origin main"), 2],
  ["bash-guard.mjs", bash("git -C . reset --hard"), 2],
  ["bash-guard.mjs", bash("git checkout -- ."), 2],
  ["bash-guard.mjs", bash("git branch -D old"), 2],
  ["bash-guard.mjs", bash("git stash"), 2],
  ["bash-guard.mjs", bash("git config user.name x"), 2],
  ["bash-guard.mjs", bash('bash -c "git add -A"'), 2],
  ["bash-guard.mjs", bash("ls | xargs git rm"), 2],
  ["bash-guard.mjs", bash("gh pr create --fill"), 2],
  ["bash-guard.mjs", bash("gh api -X POST repos/o/r/issues"), 2],
  ["bash-guard.mjs", bash("gh api repos/o/r/issues -f title=x"), 2],
  ["bash-guard.mjs", bash("rm -f file.txt"), 2],
  ["bash-guard.mjs", bash("rmdir old"), 2],
  ["bash-guard.mjs", bash("npx prettier --check ."), 2],
  ["bash-guard.mjs", bash("npm install"), 2],
  ["bash-guard.mjs", bash("cat .env"), 2],
  ["bash-guard.mjs", bash("grep KEY ../../.env.local"), 2],
  [
    "bash-guard.mjs",
    bash(
      "pnpm --filter @onemarketplace/api exec tsx scripts/backfill-search-text.ts",
    ),
    2,
  ],
  ["bash-guard.mjs", bash("node services/api/scripts/rewrite.ts"), 2],
  [
    "protect-generated.mjs",
    edit(path.join(projectDir, "docs", "api", "openapi.json")),
    2,
  ],
  [
    "protect-generated.mjs",
    edit(
      path.join(
        projectDir,
        "packages",
        "api-client",
        "src",
        "generated",
        "types.ts",
      ),
    ),
    2,
  ],
  [
    "protect-generated.mjs",
    edit("services/api/drizzle/0001_thin_iron_fist.sql"),
    2,
  ],
  [
    "protect-generated.mjs",
    edit(
      path.join(
        projectDir,
        "services",
        "api",
        "drizzle",
        "meta",
        "_journal.json",
      ),
    ),
    2,
  ],
  [
    "protect-generated.mjs",
    edit("services/api/drizzle/0099_new_migration.sql"),
    0,
  ],
  ["protect-generated.mjs", edit("services/api/src/server.ts"), 0],
  ["protect-generated.mjs", edit("C:/elsewhere/docs/api/openapi.json"), 0],
  ["protect-files.mjs", edit(".env"), 2],
  ["protect-files.mjs", edit("pnpm-lock.yaml"), 2],
  ["protect-files.mjs", edit("AGENTS.md"), 0],
  ["protect-files.mjs", edit(".env.example"), 0],
  ["protect-files.mjs", edit("apps/client-dashboard/.env.example"), 0],
  ["protect-files.mjs", edit("services/api/.env.example"), 0],
  ["protect-files.mjs", edit("apps/client-dashboard/.env.local"), 2],
  ["protect-files.mjs", edit("services/api/.env.production"), 2],
  ["protect-files.mjs", edit("services/api/.env.test.local"), 2],
  ["protect-files.mjs", edit(".env.example.local"), 2],
  ["protect-files.mjs", read(".env.example"), 0],
  ["protect-files.mjs", read("apps/client-dashboard/.env.example"), 0],
  ["protect-files.mjs", read(".env"), 2],
  ["protect-files.mjs", read("apps/client-dashboard/.env.local"), 2],
  ["protect-files.mjs", read("services/api/.env.production"), 2],
  ["protect-files.mjs", read("pnpm-lock.yaml"), 0],
];

let failed = 0;
for (const [hook, input, expected] of cases) {
  const result = run(hook, input);
  const ok = result.status === expected;
  if (!ok) failed += 1;
  const label = input.tool_input.command ?? input.tool_input.file_path;
  process.stdout.write(
    `${ok ? "ok  " : "FAIL"} ${hook} exit ${result.status} (want ${expected}) ${label}\n`,
  );
}

const trimmed = run(
  "trim-test-output.mjs",
  bash("pnpm --filter @onemarketplace/api test:quiet src/shared"),
);
const trimmedOk =
  trimmed.status === 0 &&
  /"updatedInput"/.test(trimmed.stdout) &&
  /run-trimmed\.mjs/.test(trimmed.stdout);
const untouched = [
  "pnpm check",
  "pnpm --filter @onemarketplace/api test:quiet a && echo done",
  "CLAUDE_FULL_TEST_OUTPUT=1 pnpm test:quiet",
  "git status",
].every((command) => run("trim-test-output.mjs", bash(command)).stdout === "");
if (!trimmedOk || !untouched) failed += 1;
process.stdout.write(
  `${trimmedOk ? "ok  " : "FAIL"} trim-test-output.mjs rewrites a plain test command\n`,
);
process.stdout.write(
  `${untouched ? "ok  " : "FAIL"} trim-test-output.mjs leaves other commands alone\n`,
);

const formatCheck = run("format-edited.mjs", edit("docs/does-not-exist.md"));
const formatSkip = run("format-edited.mjs", edit(".env"));
const formatOk = formatCheck.status === 0 && formatSkip.status === 0;
if (!formatOk) failed += 1;
process.stdout.write(
  `${formatOk ? "ok  " : "FAIL"} format-edited.mjs skips missing and .env files\n`,
);

process.stdout.write(
  failed === 0 ? "all hook checks passed\n" : `${failed} hook checks failed\n`,
);
process.exit(failed === 0 ? 0 : 1);
