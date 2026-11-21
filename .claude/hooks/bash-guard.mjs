import path from "node:path";
import { deny, readInput } from "./lib.mjs";

const gitReadOnly = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "ls-files",
  "rev-parse",
  "rev-list",
  "describe",
  "shortlog",
  "cat-file",
  "ls-tree",
  "merge-base",
  "check-ignore",
  "grep",
  "show-ref",
  "for-each-ref",
  "name-rev",
  "ls-remote",
  "diff-tree",
  "diff-files",
  "diff-index",
  "count-objects",
  "version",
  "help",
]);

const branchWriteFlags =
  /^-(d|D|m|M|c|C|f|u)$|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description)/;

const ghReadOnly = new Map([
  ["auth", new Set(["status"])],
  ["run", new Set(["list", "view"])],
  ["pr", new Set(["view", "list", "checks"])],
]);

const wrappers = new Set([
  "command",
  "sudo",
  "env",
  "time",
  "nice",
  "nohup",
  "xargs",
  "exec",
]);
const textOnly = new Set([
  "echo",
  "printf",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "findstr",
  "select-string",
]);
const removers = new Set([
  "rm",
  "rmdir",
  "rd",
  "del",
  "erase",
  "unlink",
  "shred",
  "trash",
  "remove-item",
  "ri",
]);
const forbiddenManagers = new Set(["npm", "npx", "yarn"]);
const scriptRunners = new Set(["tsx", "node", "ts-node", "bun", "deno"]);
const linters = new Set(["eslint", "prettier", "tsc"]);
const envFile = /(^|[\\/=])\.env(\.[\w.-]+)?$/;
const envTemplate = /(^|[\\/=])\.env\.example$/i;
const isEnvFile = (token) => envFile.test(token) && !envTemplate.test(token);
const scriptFile = /(^|[\\/])scripts[\\/][^\s]*\.(ts|mts|cts)$/;
const envSafe = new Set(["ls", "dir", "git", "test", "stat"]);

const unquote = (token) => token.replace(/^["'`]+|["'`]+$/g, "");

const segmentsOf = (command) =>
  command
    .split(/\|\||&&|\$\(|[;|&\n`()]/)
    .map((segment) => segment.trim().split(/\s+/).map(unquote).filter(Boolean))
    .filter((tokens) => tokens.length > 0);

const commandName = (tokens) => {
  let index = 0;
  while (
    index < tokens.length &&
    (/^\w+=/.test(tokens[index]) || wrappers.has(tokens[index].toLowerCase()))
  ) {
    index += 1;
  }
  const raw = tokens[index] ?? "";
  return path
    .basename(raw.replaceAll("\\", "/"))
    .toLowerCase()
    .replace(/\.(exe|cmd)$/, "");
};

const checkGit = (tokens, start) => {
  let index = start + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "-C" || token === "-c") index += 2;
    else if (token.startsWith("-")) index += 1;
    else break;
  }
  const sub = tokens[index]?.toLowerCase();
  const args = tokens.slice(index + 1);
  if (!sub) return null;
  if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) {
    return `git ${sub} --output writes a file`;
  }
  if (gitReadOnly.has(sub)) return null;
  if (sub === "branch") {
    const writes = args.some((arg) => branchWriteFlags.test(arg));
    const listing = args.some((arg) =>
      /^(-l|--list|-a|-r|-v|-vv|--show-current|--contains|--merged|--no-merged)$/.test(
        arg,
      ),
    );
    const bare = args.some((arg) => !arg.startsWith("-"));
    return writes || (bare && !listing)
      ? "git branch with write arguments"
      : null;
  }
  if (sub === "tag") {
    const listing = args.some((arg) =>
      /^(-l|--list|-n|--contains|--points-at)$/.test(arg),
    );
    return args.length === 0 || listing
      ? null
      : "git tag creates or deletes tags";
  }
  if (sub === "remote") {
    const first = args[0];
    return !first || first === "-v" || first === "show" || first === "get-url"
      ? null
      : "git remote changes remotes";
  }
  if (sub === "stash") {
    return args[0] === "list" || args[0] === "show"
      ? null
      : "git stash changes the working tree";
  }
  if (sub === "config") {
    return args.some((arg) =>
      /^(--get|--get-all|--get-regexp|--list|-l)$/.test(arg),
    )
      ? null
      : "git config writes configuration";
  }
  if (sub === "worktree")
    return args[0] === "list" ? null : "git worktree changes worktrees";
  if (sub === "reflog")
    return !args[0] || args[0] === "show"
      ? null
      : "git reflog changes the reflog";
  return `git ${sub} is a git write command`;
};

const checkGh = (tokens, start) => {
  const rest = tokens
    .slice(start + 1)
    .filter((token) => !token.startsWith("-") || token === "-X");
  const sub = rest[0]?.toLowerCase();
  const args = tokens.slice(start + 1);
  if (!sub) return null;
  if (sub === "api") {
    const methodIndex = args.findIndex((arg) => /^(-X|--method)$/i.test(arg));
    const inline = args.find((arg) => /^(--method=|-X.)/i.test(arg));
    const method = (
      methodIndex >= 0
        ? (args[methodIndex + 1] ?? "")
        : (inline?.replace(/^(--method=|-X)/i, "") ?? "GET")
    ).toUpperCase();
    const body = args.some((arg) =>
      /^(-[fF]|--field|--raw-field|--input)/.test(arg),
    );
    const graphql = args.includes("graphql");
    return method !== "GET" || body || graphql
      ? "gh api is limited to GET requests"
      : null;
  }
  const allowed = ghReadOnly.get(sub);
  if (allowed?.has((rest[1] ?? "").toLowerCase())) return null;
  return `gh ${sub} ${rest[1] ?? ""} is not a read-only gh command`.replace(
    /\s+/g,
    " ",
  );
};

const analyse = (command) => {
  for (const tokens of segmentsOf(command)) {
    const name = commandName(tokens);
    if (!name) continue;
    if (removers.has(name))
      return "Deleting files is not allowed. List files to delete in the report instead.";
    if (forbiddenManagers.has(name))
      return "Use pnpm only, never npm, npx or yarn.";
    if (!envSafe.has(name) && tokens.some(isEnvFile)) {
      return "Never read or use .env files.";
    }
    if (textOnly.has(name) || name === "gitleaks") continue;
    const lowered = tokens.map((token) =>
      path
        .basename(token.replaceAll("\\", "/"))
        .toLowerCase()
        .replace(/\.(exe|cmd)$/, ""),
    );
    const gitAt = lowered.indexOf("git");
    if (gitAt >= 0) {
      const problem = checkGit(tokens, gitAt);
      if (problem)
        return `Git write is not allowed (${problem}). Print the command for the user instead.`;
    }
    const ghAt = lowered.indexOf("gh");
    if (ghAt >= 0) {
      const problem = checkGh(tokens, ghAt);
      if (problem) return `GitHub write is not allowed (${problem}).`;
    }
    if (
      tokens.some((token) => scriptFile.test(token)) &&
      lowered.some((token) => scriptRunners.has(token)) &&
      !lowered.some((token) => linters.has(token))
    ) {
      return "Never run services/api/scripts/*.ts.";
    }
  }
  return null;
};

try {
  const input = await readInput();
  if (
    input.tool_name === "Bash" &&
    typeof input.tool_input?.command === "string"
  ) {
    const problem = analyse(input.tool_input.command);
    if (problem) deny(`Blocked: ${problem}`);
  }
} catch {
  deny("Blocked: bash-guard hook could not parse the tool input.");
}
