import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeRepositoryPurity } from "./repository-sql.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "repository-purity-"));
  roots.push(root);
  for (const [key, content] of Object.entries(files)) {
    const file = path.join(root, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

describe("repositories only run SQL", () => {
  it("has no ApiError, throw or non-SQL I/O in any repository file", () => {
    const found = analyzeRepositoryPurity();
    expect(
      [...found].map(([key, violations]) => {
        const first = violations[0]!;
        return `${key}:${first.line} ${first.kind} ${first.detail}`;
      }),
      "a repository returns data or a result; the service interprets it and throws",
    ).toEqual([]);
  });

  it("flags an ApiError import, a throw and non-SQL imports", () => {
    const root = tree({
      "modules/a/a.repository.ts": `
import { ApiError } from "../../shared/http/api-error.js";
export const find = async () => {
  throw new ApiError(500, "no");
};
`,
      "modules/b/b.repository.ts": `
export const find = () => {
  throw new Error("plain");
};
`,
      "modules/c/c.repository.ts": `
import { redis } from "../../infrastructure/redis.js";
export const find = () => fetch("https://example.test");
`,
    });
    const result = analyzeRepositoryPurity(root);
    expect(
      result
        .get("modules/a/a.repository.ts")!
        .map((v) => v.kind)
        .sort(),
    ).toEqual(["api-error", "api-error", "api-error", "throw"]);
    expect(result.get("modules/b/b.repository.ts")!.map((v) => v.kind)).toEqual(
      ["throw"],
    );
    expect(
      result
        .get("modules/c/c.repository.ts")!
        .map((v) => v.kind)
        .sort(),
    ).toEqual(["fetch-call", "non-sql-import"]);
  });

  it("passes a repository that only returns data and ignores non-repository files", () => {
    const root = tree({
      "modules/a/a.repository.ts": `
import type { DbExecutor } from "../../database/db-executor.js";
export const find = (executor: DbExecutor) => executor.select();
`,
      "modules/a/a.service.ts": `
import { ApiError } from "../../shared/http/api-error.js";
export const run = () => {
  throw new ApiError(404, "x");
};
`,
      "modules/a/a.repository.test.ts": `throw new Error("test");`,
    });
    expect([...analyzeRepositoryPurity(root).keys()]).toEqual([]);
  });
});
