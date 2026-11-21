import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  projectDir,
  readInput,
  relativeToProject,
  targetFile,
} from "./lib.mjs";

const formattable = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".yaml",
  ".yml",
]);
const skipped = /(^|\/)(node_modules|\.next|dist|build|coverage)\//;

try {
  const input = await readInput();
  const target = targetFile(input);
  const rel = typeof target === "string" ? relativeToProject(target) : null;
  if (rel && !skipped.test(rel)) {
    const name = path.posix.basename(rel).toLowerCase();
    const absolute = path.resolve(projectDir(), rel);
    if (
      !name.startsWith(".env") &&
      formattable.has(path.extname(name)) &&
      fs.existsSync(absolute)
    ) {
      const bin = path.join(
        projectDir(),
        "node_modules",
        "prettier",
        "bin",
        "prettier.cjs",
      );
      execFileSync(
        process.execPath,
        [
          bin,
          "--write",
          "--end-of-line",
          "auto",
          "--log-level",
          "warn",
          absolute,
        ],
        { cwd: projectDir(), stdio: ["ignore", "ignore", "pipe"] },
      );
    }
  }
} catch (error) {
  const detail = String(error?.stderr ?? error?.message ?? error)
    .split("\n")
    .slice(0, 8)
    .join("\n");
  process.stderr.write(`format-edited: prettier failed\n${detail}\n`);
  process.exit(2);
}
