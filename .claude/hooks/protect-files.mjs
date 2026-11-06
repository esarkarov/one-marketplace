import path from "node:path";

const protectedNames = new Set(["pnpm-lock.yaml"]);

const isProtected = (filePath) => {
  const name = path.basename(filePath.replaceAll("\\", "/")).toLowerCase();
  if (name === ".env.example") return false;
  return (
    name === ".env" || name.startsWith(".env.") || protectedNames.has(name)
  );
};

const block = (reason) => {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
};

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw.replace(/^﻿/, ""));
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target === "string" && isProtected(target)) {
    block(
      `Blocked: ${path.basename(target.replaceAll("\\", "/"))} is protected. Ask the user to change it, or use pnpm for the lockfile.`,
    );
  }
} catch {
  block("Blocked: protect-files hook could not parse the tool input.");
}
