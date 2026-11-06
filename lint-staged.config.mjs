import fs from "node:fs";
import path from "node:path";

const workspaces = ["apps", "services", "packages"];

const quote = (files) => files.map((file) => JSON.stringify(file)).join(" ");

const workspaceDir = (file) => {
  const [group, name] = path.relative(process.cwd(), file).split(path.sep);
  return workspaces.includes(group) ? path.join(group, name) : null;
};

const hasEslintConfig = (dir) =>
  fs.existsSync(path.join(process.cwd(), dir, "eslint.config.mjs"));

export default {
  "*.{ts,tsx,js,mjs}": (files) => {
    const byWorkspace = new Map();
    for (const file of files) {
      const dir = workspaceDir(file);
      if (dir && hasEslintConfig(dir)) {
        byWorkspace.set(dir, [...(byWorkspace.get(dir) ?? []), file]);
      }
    }
    const commands = [...byWorkspace].map(
      ([dir, group]) =>
        `pnpm --dir ${JSON.stringify(dir)} exec eslint --fix --no-warn-ignored ${quote(group)}`,
    );
    commands.push(`prettier --write ${quote(files)}`);
    return commands;
  },
  "*.{json,md,css,yaml,yml}": "prettier --write",
};
