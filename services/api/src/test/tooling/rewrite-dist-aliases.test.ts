import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

interface RewriteModule {
  rewriteSource: (source: string, fileDir: string, distRoot: string) => string;
  rewriteDist: (distRoot: string) => { files: number; specifiers: number };
  verifyDist: (distRoot: string) => string[];
}

const scriptPath = fileURLToPath(
  new URL("../../../scripts/rewrite-dist-aliases.mjs", import.meta.url),
);
const { rewriteSource, rewriteDist, verifyDist } = (await import(
  pathToFileURL(scriptPath).href
)) as RewriteModule;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const dist = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dist-aliases-"));
  roots.push(root);
  for (const [key, content] of Object.entries(files)) {
    const file = path.join(root, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

describe("rewriteSource", () => {
  const root = path.join(os.tmpdir(), "dist");
  const at = (dir: string, source: string) =>
    rewriteSource(source, path.join(root, dir), root);

  it("rewrites a static import at the root, one level and three levels deep", () => {
    expect(at("", 'import { a } from "@/x/a.js";')).toBe(
      'import { a } from "./x/a.js";',
    );
    expect(at("modules/m", 'import { a } from "@/shared/a.js";')).toBe(
      'import { a } from "../../shared/a.js";',
    );
    expect(
      at("modules/m/controllers", 'import { a } from "@/shared/errors/a.js";'),
    ).toBe('import { a } from "../../../shared/errors/a.js";');
  });

  it("rewrites export-from, side-effect and dynamic imports, in either quote style", () => {
    expect(at("a/b", 'export * from "@/c/d.js";')).toBe(
      'export * from "../../c/d.js";',
    );
    expect(at("a/b", "export { x } from '@/c/d.js';")).toBe(
      "export { x } from '../../c/d.js';",
    );
    expect(at("a", 'import "@/setup.js";')).toBe('import "../setup.js";');
    expect(at("a", 'const m = await import("@/c/d.js");')).toBe(
      'const m = await import("../c/d.js");',
    );
    expect(at("a", 'import {\n  x,\n  y,\n} from\n  "@/c/d.js";')).toBe(
      'import {\n  x,\n  y,\n} from\n  "../c/d.js";',
    );
  });

  it("keeps index.js specifiers and sibling files", () => {
    expect(
      at("modules/m", 'import { i } from "@/modules/auth/index.js";'),
    ).toBe('import { i } from "../auth/index.js";');
    expect(at("modules/m", 'import { s } from "@/modules/m/s.js";')).toBe(
      'import { s } from "./s.js";',
    );
  });

  it("leaves node:, package, relative and scoped-package specifiers alone", () => {
    const source = [
      'import fs from "node:fs";',
      'import express from "express";',
      'import { verifyToken } from "@clerk/backend";',
      'import { t } from "@typescript/native";',
      'import { a } from "./a.js";',
      'import { b } from "../b.js";',
      'const x = await import("drizzle-orm/pg-core");',
    ].join("\n");
    expect(at("a", source)).toBe(source);
  });
});

describe("rewriteDist and verifyDist", () => {
  it("rewrites nested files and then verifies clean", () => {
    const root = dist({
      "server.js":
        'import "@/app.js";\nimport { r } from "@/routes/index.js";\n',
      "app.js": "export const app = 1;\n",
      "routes/index.js": 'export * from "@/modules/m/m.route.js";\n',
      "modules/m/m.route.js":
        'import { app } from "@/app.js";\nexport const route = app;\nexport const lazy = () => import("@/routes/index.js");\n',
      "types.d.ts": 'import type { A } from "@/app.js";\nexport type B = A;\n',
    });

    expect(verifyDist(root)).toEqual([
      'modules/m/m.route.js: unrewritten alias "@/app.js"',
      'modules/m/m.route.js: unrewritten alias "@/routes/index.js"',
      'routes/index.js: unrewritten alias "@/modules/m/m.route.js"',
      'server.js: unrewritten alias "@/app.js"',
      'server.js: unrewritten alias "@/routes/index.js"',
      'types.d.ts: unrewritten alias "@/app.js"',
    ]);
    expect(rewriteDist(root)).toEqual({ files: 4, specifiers: 6 });
    expect(verifyDist(root)).toEqual([]);
    expect(readFileSync(path.join(root, "server.js"), "utf8")).toBe(
      'import "./app.js";\nimport { r } from "./routes/index.js";\n',
    );
    expect(
      readFileSync(path.join(root, "modules/m/m.route.js"), "utf8"),
    ).toContain('import("../../routes/index.js")');
    expect(rewriteDist(root)).toEqual({ files: 0, specifiers: 0 });
  });

  it("reports a relative specifier that does not resolve to a file", () => {
    const root = dist({
      "a.js":
        'import { b } from "./b.js";\nimport { c } from "./missing.js";\n',
      "b.js": "export const b = 1;\n",
    });
    expect(verifyDist(root)).toEqual([
      'a.js: "./missing.js" does not resolve to a file',
    ]);
  });

  it("reports an alias that rewrites to a missing file", () => {
    const root = dist({ "a.js": 'import { x } from "@/gone.js";\n' });
    rewriteDist(root);
    expect(verifyDist(root)).toEqual([
      'a.js: "./gone.js" does not resolve to a file',
    ]);
  });

  it("does not report node: or package specifiers", () => {
    const root = dist({
      "a.js":
        'import fs from "node:fs";\nimport e from "express";\nimport "@clerk/backend";\n',
    });
    expect(verifyDist(root)).toEqual([]);
  });
});
