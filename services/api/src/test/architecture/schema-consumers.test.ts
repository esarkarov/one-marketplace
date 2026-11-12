import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { listTsFiles, parse, srcDir, toKey } from "./table-access.js";
import { tableFileOf } from "./table-files.js";
import { tableOwners } from "./table-ownership.js";

const apiDir = path.resolve(srcDir, "..");
const ownerFiles = [...new Set(Object.values(tableOwners))].map(tableFileOf);

describe("test support tables", () => {
  const exported = parse(path.join(srcDir, "test/support/tables.ts"))
    .statements.filter(ts.isExportDeclaration)
    .flatMap((statement) => {
      const names =
        statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [];
      const source = ts.isStringLiteral(statement.moduleSpecifier!)
        ? statement.moduleSpecifier.text
        : "";
      return names.map((name) => ({ name, source }));
    });

  it("re-exports every table and enum, and nothing else", () => {
    expect(exported.map((entry) => entry.name).sort()).toEqual(
      Object.keys(tableOwners).sort(),
    );
  });

  it("re-exports each one from its owner's table file", () => {
    expect(
      exported
        .filter(
          (entry) =>
            entry.source !==
            `../../${tableFileOf(tableOwners[entry.name]!).replace(/\.ts$/, ".js")}`,
        )
        .map((entry) => entry.name),
    ).toEqual([]);
  });
});

describe("drizzle schema glob", () => {
  const config = readFileSync(path.join(apiDir, "drizzle.config.ts"), "utf8");
  const declared = /schema:\s*(\[[^\]]*\]|"[^"]*")/.exec(config)?.[1];
  const patterns: string[] = declared ? [JSON.parse(declared)].flat() : [];

  it("is a list of globs", () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("matches exactly the table files and not the zod schemas files", () => {
    const matched = patterns
      .flatMap((pattern) =>
        globSync(pattern.replace(/^\.\//, ""), { cwd: apiDir }),
      )
      .map((file) => file.split(path.sep).join("/"))
      .sort();
    expect(matched).toEqual(ownerFiles.map((file) => `src/${file}`).sort());
  });
});

describe("source references", () => {
  it("names no central database schema path", () => {
    const stale = listTsFiles(srcDir)
      .filter((file) => !toKey(srcDir, file).startsWith("test/architecture/"))
      .filter((file) => readFileSync(file, "utf8").includes("database/schema"))
      .map((file) => toKey(srcDir, file));
    expect(stale).toEqual([]);
  });
});
