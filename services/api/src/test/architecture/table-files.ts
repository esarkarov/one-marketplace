import ts from "typescript";
import {
  discoverTableDefinitions,
  isTestKey,
  listTsFiles,
  parse,
  resolveImport,
  srcDir,
  toKey,
} from "./table-access.js";

const TABLE_FILE = /^modules\/([^/]+)\/\1\.schema\.ts$/;

export const isTableFile = (key: string) => TABLE_FILE.test(key);

export const tableFileOf = (owner: string) =>
  `modules/${owner}/${owner}.schema.ts`;

const isDrizzlePackage = (specifier: string) =>
  specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/");

const importSpecifiers = (source: ts.SourceFile) => {
  const found: { specifier: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, node });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

export const checkTableFiles = (root = srcDir): string[] => {
  const problems: string[] = [];
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (isTestKey(key)) continue;
    const looksLikeTableFile = key.endsWith(".schema.ts");
    if (looksLikeTableFile && !isTableFile(key)) {
      problems.push(
        `${key}: a table file is exactly modules/<name>/<name>.schema.ts`,
      );
    }
    if (!isTableFile(key)) continue;
    const source = parse(file);
    for (const { specifier, node } of importSpecifiers(source)) {
      if (isDrizzlePackage(specifier)) continue;
      const resolved = resolveImport(file, specifier);
      if (resolved && isTableFile(toKey(root, resolved))) continue;
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      problems.push(
        `${key}:${line} imports "${specifier}"; a table file may import only drizzle-orm packages and other table files`,
      );
    }
  }
  for (const definition of discoverTableDefinitions(root)) {
    if (!isTableFile(definition.file)) {
      problems.push(
        `${definition.file}: defines ${definition.name}; tables and enums are defined only in table files`,
      );
    }
  }
  return problems;
};

export const findTableFileCycles = (root = srcDir): string[] => {
  const graph = new Map<string, Set<string>>();
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (!isTableFile(key)) continue;
    const targets = new Set<string>();
    for (const { specifier } of importSpecifiers(parse(file))) {
      const resolved = resolveImport(file, specifier);
      const target = resolved ? toKey(root, resolved) : null;
      if (target && isTableFile(target)) targets.add(target);
    }
    graph.set(key, targets);
  }
  const cycles: string[] = [];
  const state = new Map<string, "open" | "done">();
  const visit = (node: string, trail: string[]) => {
    state.set(node, "open");
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === "open") {
        cycles.push([...trail.slice(trail.indexOf(next)), next].join(" -> "));
      } else if (!state.has(next)) {
        visit(next, [...trail, next]);
      }
    }
    state.set(node, "done");
  };
  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node, [node]);
  }
  return cycles;
};

export const findDatabaseModuleImports = (root = srcDir): string[] =>
  listTsFiles(root).flatMap((file) => {
    const key = toKey(root, file);
    if (!key.startsWith("database/")) return [];
    return importSpecifiers(parse(file)).flatMap(({ specifier }) => {
      const resolved = resolveImport(file, specifier);
      const target = resolved ? toKey(root, resolved) : null;
      return target?.startsWith("modules/")
        ? [`${key} imports ${target}; database/ imports no module files`]
        : [];
    });
  });
