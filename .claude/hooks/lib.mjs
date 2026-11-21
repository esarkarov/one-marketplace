import path from "node:path";

export const readInput = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw.replace(/^﻿/, ""));
};

export const projectDir = () =>
  path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

export const deny = (reason) => {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
};

export const relativeToProject = (file) => {
  const rel = path.relative(projectDir(), path.resolve(projectDir(), file));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
};

export const targetFile = (input) =>
  input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? null;
