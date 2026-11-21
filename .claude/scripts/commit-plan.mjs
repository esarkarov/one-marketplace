import { execFileSync } from "node:child_process";
import { changedFiles } from "./changed-areas.mjs";

const trailer = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

const classify = (file) => {
  const [group, name] = file.split("/");
  if (file === "pnpm-lock.yaml")
    return {
      key: "lockfile",
      type: "chore",
      scope: "deps",
      separate:
        "pnpm-lock.yaml changes only with a dependency change; commit it with the package.json that caused it or on its own",
    };
  if (
    file === "docs/api/openapi.json" ||
    file.startsWith("packages/api-client/src/generated/")
  ) {
    return {
      key: "contract",
      type: "feat",
      scope: "api",
      separate:
        "generated contract files belong in the same commit as the API change that produced them",
    };
  }
  if (
    file.startsWith(".claude/") ||
    file === "AGENTS.md" ||
    file === "CLAUDE.md" ||
    file.startsWith("docs/claude-code-setup") ||
    file === ".gitignore"
  ) {
    return { key: "claude", type: "chore", scope: "claude" };
  }
  if (group === "services" && name) {
    return {
      key: `${group}/${name}`,
      type: "feat",
      scope: name,
      separate: file.startsWith("services/api/drizzle/")
        ? "migration files go with the schema change that generated them"
        : undefined,
    };
  }
  if (group === "apps" && name)
    return { key: `apps/${name}`, type: "feat", scope: name };
  if (group === "packages" && name)
    return { key: `packages/${name}`, type: "feat", scope: name };
  if (group === ".github") return { key: "ci", type: "ci", scope: "ci" };
  if (group === "docs") return { key: "docs", type: "docs", scope: "docs" };
  return { key: "root", type: "chore", scope: "repo" };
};

const files = changedFiles();
const groups = new Map();
for (const file of files) {
  const info = classify(file);
  const entry = groups.get(info.key) ?? {
    ...info,
    files: [],
    notes: new Set(),
  };
  entry.files.push(file);
  if (info.separate) entry.notes.add(info.separate);
  groups.set(info.key, entry);
}

let hasGitleaks = true;
try {
  execFileSync("gitleaks", ["version"], { stdio: "ignore" });
} catch {
  hasGitleaks = false;
}

const quote = (file) => (/[\s\[\]()]/.test(file) ? `"${file}"` : file);
const out = [];
out.push(
  `CHANGED FILES: ${files.length} in ${groups.size} group(s). Nothing below is executed.`,
);
for (const group of groups.values()) {
  out.push("");
  out.push(`GROUP ${group.key} (${group.files.length} files)`);
  out.push(`  git add -- ${group.files.map(quote).join(" ")}`);
  out.push(
    `  git commit -m "${group.type}(${group.scope}): <subject>" -m "<body lines, at most 100 characters each>" -m "${trailer}"`,
  );
  for (const note of group.notes) out.push(`  NOTE: ${note}`);
}
out.push("");
out.push("BEFORE COMMITTING: git status --short; git diff --cached --stat");
out.push(
  `HOOKS: pre-commit runs gitleaks on staged files (${hasGitleaks ? "gitleaks found" : "gitleaks NOT found, the hook will fail"}), then lint-staged; commit-msg runs commitlint.`,
);
out.push(
  "IF GITLEAKS BLOCKS: run gitleaks git --pre-commit --staged --redact -v --no-banner, read the finding, remove the secret or allowlist a verified false positive in .gitleaks.toml (separate commit).",
);
out.push(
  "  Only if the hook cannot run (tool missing) and you ran the scan above clean: add --no-verify to the commit. This also skips lint-staged and commitlint, so run pnpm check and check the message first.",
);
process.stdout.write(`${out.join("\n")}\n`);
