import { describe, expect, it } from "vitest";
import {
  analyzeTableAccess,
  importerKeyOf,
  listTsFiles,
  parse,
  resolveImport,
  srcDir,
  toKey,
} from "./table-access.js";
import { isTableFile } from "./table-files.js";
import { tableOwners } from "./table-ownership.js";
import ts from "typescript";

const STORE = "notification-store";

const importsOf = (file: string) =>
  parse(file)
    .statements.filter(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) ||
        (ts.isExportDeclaration(statement) &&
          Boolean(statement.moduleSpecifier)),
    )
    .map((statement) => {
      const specifier = (statement as ts.ImportDeclaration).moduleSpecifier;
      return ts.isStringLiteral(specifier) ? specifier.text : "";
    })
    .map((specifier) => resolveImport(file, specifier))
    .filter((resolved): resolved is string => resolved !== null)
    .map((resolved) => toKey(srcDir, resolved));

const moduleOf = (key: string) => /^modules\/([^/]+)\//.exec(key)?.[1] ?? null;

const files = listTsFiles(srcDir).map((file) => ({
  file,
  key: toKey(srcDir, file),
}));

describe("notification-store", () => {
  it("owns the notifications table", () => {
    expect(tableOwners.notifications).toBe(STORE);
  });

  it("is a layer 0 module: it imports no other module except table files", () => {
    const offending = files
      .filter(({ key }) => moduleOf(key) === STORE)
      .flatMap(({ file, key }) =>
        importsOf(file)
          .filter((target) => {
            const targetModule = moduleOf(target);
            return (
              targetModule !== null &&
              targetModule !== STORE &&
              !isTableFile(target)
            );
          })
          .map((target) => `${key} -> ${target}`),
      );
    expect(offending).toEqual([]);
  });

  it("is imported by other modules only through index.ts, or by notifications through its table file", () => {
    const offending = files
      .filter(({ key }) => moduleOf(key) !== STORE)
      .filter(
        ({ key }) => !key.endsWith(".test.ts") && !key.startsWith("test/"),
      )
      .flatMap(({ file, key }) =>
        importsOf(file)
          .filter((target) => moduleOf(target) === STORE)
          .filter(
            (target) =>
              target !== `modules/${STORE}/index.ts` &&
              !(
                isTableFile(target) &&
                importerKeyOf(key) === "notifications" &&
                key.endsWith(".repository.ts")
              ),
          )
          .map((target) => `${key} -> ${target}`),
      );
    expect(offending).toEqual([]);
  });

  it("is the only writer of the notifications table", () => {
    const { edges } = analyzeTableAccess((name) => tableOwners[name]);
    const touching = [...edges.values()].filter((edge) => edge.owner === STORE);
    expect(touching.map((edge) => `${edge.importer}:${edge.access}`)).toEqual([
      "notifications:read",
    ]);
  });
});
