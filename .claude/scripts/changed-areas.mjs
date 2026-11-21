import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);

export const changedFiles = () =>
  [
    ...new Set([
      ...git("diff", "--name-only", "HEAD"),
      ...git("ls-files", "--others", "--exclude-standard"),
    ]),
  ]
    .filter((file) => fs.existsSync(path.join(root, file)))
    .sort();

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return null;
  }
};

const code = /\.(ts|tsx|js|mjs)$/;
const formattable = /\.(ts|tsx|js|mjs|cjs|json|md|css|yaml|yml)$/;
const contractPath = /(\.route\.ts|\/schemas\/|\/responses\/|\/openapi\/)/;
const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

export const plan = (files) => {
  const commands = [];
  const notes = [];
  const packages = new Map();

  for (const file of files) {
    const [group, name] = file.split("/");
    if (["apps", "packages", "services"].includes(group) && name) {
      const dir = `${group}/${name}`;
      const manifest = readJson(`${dir}/package.json`);
      if (manifest?.name) {
        const entry = packages.get(dir) ?? {
          name: manifest.name,
          manifest,
          files: [],
        };
        entry.files.push(file.slice(dir.length + 1));
        packages.set(dir, entry);
      }
    }
  }

  for (const [dir, { name, manifest, files: own }] of packages) {
    const scripts = manifest.scripts ?? {};
    const hasEslint = fs.existsSync(path.join(root, dir, "eslint.config.mjs"));
    const isApi = name === "@onemarketplace/api";
    let contractChanged = false;

    if (isApi) {
      const modules = new Set();
      let sharedSource = false;
      for (const file of own) {
        const match = /^src\/modules\/([^/]+)\//.exec(file);
        if (match) modules.add(match[1]);
        else if (file.startsWith("src/") && !file.startsWith("src/test/"))
          sharedSource = true;
        if (file.startsWith("src/") && contractPath.test(`/${file}`))
          contractChanged = true;
        if (file.startsWith("drizzle/"))
          notes.push(
            `${dir}: migration files changed; check with /db-change rules`,
          );
      }
      const targets = [...modules].map((module) => `src/modules/${module}`);
      if (sharedSource || own.some((file) => file.startsWith("src/test/")))
        targets.push("src/test/architecture");
      if (targets.length > 0) {
        commands.push(`pnpm --filter ${name} test:quiet ${targets.join(" ")}`);
      }
    } else if (scripts.test && own.some((file) => code.test(file))) {
      commands.push(`pnpm --filter ${name} exec vitest run`);
    }

    if (
      scripts.typecheck &&
      own.some((file) => /\.(ts|tsx|mjs|json|css)$/.test(file))
    ) {
      commands.push(`pnpm --filter ${name} typecheck`);
    }

    const lintable = own.filter(
      (file) => code.test(file) && !file.startsWith("scripts/"),
    );
    if (hasEslint && lintable.length > 0) {
      for (const part of chunk(lintable, 40)) {
        commands.push(
          `pnpm --filter ${name} exec eslint --no-warn-ignored ${part.join(" ")}`,
        );
      }
    }

    if (isApi && contractChanged) {
      commands.push("sha256sum docs/api/openapi.json");
      commands.push("pnpm --filter @onemarketplace/api openapi:generate");
      commands.push("sha256sum docs/api/openapi.json");
      notes.push(
        "routes or schemas changed: the two sha256 lines must differ only if the contract changed; then run pnpm --filter @onemarketplace/api-client generate and commit both",
      );
    }
  }

  const formatFiles = files.filter(
    (file) =>
      formattable.test(file) &&
      !file.startsWith(".claude/skills/vercel") &&
      file !== "pnpm-lock.yaml",
  );
  for (const part of chunk(formatFiles, 60)) {
    commands.push(
      `pnpm exec prettier --check --end-of-line auto ${part.join(" ")}`,
    );
  }

  const uniqueCommands = [...new Set(commands)];
  return { commands: uniqueCommands, notes };
};

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const files = changedFiles();
  const { commands, notes } = plan(files);
  const dirs = new Map();
  for (const file of files) {
    const [group, name] = file.split("/");
    const key =
      ["apps", "packages", "services"].includes(group) && name
        ? `${group}/${name}`
        : group;
    dirs.set(key, (dirs.get(key) ?? 0) + 1);
  }
  process.stdout.write(`CHANGED FILES: ${files.length}\n`);
  for (const [dir, count] of dirs)
    process.stdout.write(`  area ${dir}: ${count}\n`);
  process.stdout.write("TIER 1 COMMANDS:\n");
  for (const command of commands) process.stdout.write(`  ${command}\n`);
  for (const note of notes) process.stdout.write(`NOTE: ${note}\n`);
}
