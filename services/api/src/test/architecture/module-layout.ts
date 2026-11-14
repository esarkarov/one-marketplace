import { readdirSync } from "node:fs";
import path from "node:path";

const ROOT_ENTRY_KINDS = ["route", "socket", "cron", "consumer"];

const FOLDER_FILES: Record<string, RegExp> = {
  controllers: /^[^/]+\.controller\.ts$/,
  services: /^[^/]+\.(?:service|sse)\.ts$/,
  repositories: /^[^/]+\.repository\.ts$/,
  schemas: /^[^/]+\.schema\.ts$/,
  responses: /^[^/]+\.responses\.ts$/,
  middleware: /^[^/]+\.middleware\.ts$/,
  tests: /^[^/]+\.test\.ts$/,
  types: /^[^/]+\.types\.ts$/,
  constants: /^[^/]+\.constants\.ts$/,
  utils: /^[^/]+\.tsx?$/,
};

const SUFFIX_FOLDERS: [RegExp, string][] = [
  [/\.controller\.ts$/, "controllers"],
  [/\.repository\.ts$/, "repositories"],
  [/\.service\.ts$/, "services"],
  [/\.model\.ts$/, "models"],
  [/\.responses\.ts$/, "responses"],
  [/\.schema\.ts$/, "schemas"],
  [/\.middleware\.ts$/, "middleware"],
  [/\.types\.ts$/, "types"],
  [/\.constants\.ts$/, "constants"],
  [/\.test\.tsx?$/, "tests"],
];

export const moduleFolders = [...Object.keys(FOLDER_FILES), "models"];

const listFiles = (dir: string, prefix = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), rel)
      : [rel];
  });

export const checkModuleLayout = (modulesDir: string): string[] => {
  const problems: string[] = [];
  const modules = readdirSync(modulesDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  for (const { name: moduleName } of modules) {
    const rootEntry = new RegExp(
      `^(?:index|${moduleName}\\.(?:${ROOT_ENTRY_KINDS.join("|")}))\\.ts$`,
    );
    const modelFile = `${moduleName}.model.ts`;
    for (const file of listFiles(path.join(modulesDir, moduleName))) {
      const key = `modules/${moduleName}/${file}`;
      const parts = file.split("/");
      const name = parts[parts.length - 1]!;
      if (parts.length === 1) {
        if (!rootEntry.test(name)) {
          problems.push(
            `${key}: only ${[...ROOT_ENTRY_KINDS.map((kind) => `${moduleName}.${kind}.ts`), "index.ts"].join(", ")} may sit at the module root`,
          );
        }
        continue;
      }
      const folder = parts[0]!;
      if (!moduleFolders.includes(folder)) {
        problems.push(`${key}: unknown folder ${folder}/`);
        continue;
      }
      if (parts.length > 2) {
        problems.push(`${key}: folders are not nested inside ${folder}/`);
        continue;
      }
      const home = SUFFIX_FOLDERS.find(([suffix]) => suffix.test(name))?.[1];
      if (home && home !== folder) {
        problems.push(`${key}: ${name} belongs in ${home}/`);
        continue;
      }
      if (folder === "models") {
        if (name !== modelFile) {
          problems.push(`${key}: models/ holds only ${modelFile}`);
        }
        continue;
      }
      if (!FOLDER_FILES[folder]!.test(name)) {
        problems.push(`${key}: ${folder}/ does not hold this file name`);
      }
    }
  }
  return problems;
};
