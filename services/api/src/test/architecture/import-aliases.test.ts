import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  apiDir,
  collectSpecifiers,
  findParentRelativeImports,
  findUnresolvedAliases,
  listSourceFiles,
  srcRoot,
} from "./import-specifiers.js";

const scanned = [srcRoot, path.join(apiDir, "scripts")];

describe("import aliases", () => {
  it("has no parent-relative import, export-from, dynamic import or mock path in src or scripts", () => {
    expect(
      findParentRelativeImports(scanned),
      "import across directories with @/ (the src root); only ./ stays relative (ADR 0020)",
    ).toEqual([]);
  });

  it("resolves every @/ specifier to an existing file under src", () => {
    expect(findUnresolvedAliases(scanned)).toEqual([]);
  });

  it("sees a meaningful number of alias specifiers", () => {
    const aliases = scanned
      .flatMap((dir) => listSourceFiles(dir))
      .flatMap((file) => collectSpecifiers(file))
      .filter(({ specifier }) => specifier.startsWith("@/"));
    expect(aliases.length).toBeGreaterThan(1500);
  });
});

describe("import alias analyzer", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });
  const tree = (files: Record<string, string>) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "import-aliases-"));
    roots.push(root);
    for (const [key, content] of Object.entries(files)) {
      const file = path.join(root, key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    return root;
  };

  it("flags every kind of parent-relative specifier", () => {
    const root = tree({
      "a/a.ts": [
        'import { x } from "../b/b.js";',
        'export { y } from "../../c.js";',
        'const z = await import("../d.js");',
        'type T = typeof import("../e.js");',
        'vi.mock("../f.js", () => ({}));',
        'vi.doMock("../g.js");',
        'const o = await importOriginal<typeof import("../h.js")>();',
        'import { ok } from "./sibling.js";',
        'import { alias } from "@/b/b.js";',
        'import pkg from "@clerk/backend";',
      ].join("\n"),
    });
    const found = findParentRelativeImports([root]).map((entry) =>
      entry.replace(/^.*:(\d+) /, "$1 "),
    );
    expect(found).toEqual([
      "1 ../b/b.js",
      "2 ../../c.js",
      "3 ../d.js",
      "4 ../e.js",
      "5 ../f.js",
      "6 ../g.js",
      "7 ../h.js",
    ]);
  });

  it("flags an @/ specifier that does not resolve and accepts one that does", () => {
    const root = tree({
      "b/b.ts": "export const b = 1;\n",
      "c/index.ts": "export const c = 1;\n",
      "a/a.ts": [
        'import { b } from "@/b/b.js";',
        'import { c } from "@/c/index.js";',
        'import { gone } from "@/b/missing.js";',
        'vi.mock("@/nowhere/x.js");',
      ].join("\n"),
    });
    expect(
      findUnresolvedAliases([root], root).map((entry) =>
        entry.replace(/^.*:(\d+) /, "$1 "),
      ),
    ).toEqual(["3 @/b/missing.js", "4 @/nowhere/x.js"]);
  });
});
