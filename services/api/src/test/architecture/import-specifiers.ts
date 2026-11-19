import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const apiDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const srcRoot = path.join(apiDir, "src");

const MOCK_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

export interface SpecifierSite {
  file: string;
  line: number;
  specifier: string;
}

export const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return ["node_modules", "dist", "coverage"].includes(entry.name)
          ? []
          : listSourceFiles(full);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

export const collectSpecifiers = (file: string): SpecifierSite[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: SpecifierSite[] = [];
  const add = (literal: ts.Node | undefined) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    found.push({
      file,
      line:
        source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1,
      specifier: literal.text,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        MOCK_CALLS.has(callee.name.text)
      ) {
        add(node.arguments[0]);
      } else if (ts.isIdentifier(callee) && callee.text === "importOriginal") {
        add(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

export const isParentRelative = (specifier: string) =>
  specifier === ".." || specifier.startsWith("../");

export const resolveAlias = (
  specifier: string,
  root = srcRoot,
): string | null => {
  if (!specifier.startsWith("@/")) return null;
  const base = path.join(root, specifier.slice(2));
  for (const candidate of [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    base,
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

export const findParentRelativeImports = (dirs: string[]): string[] =>
  dirs.flatMap((dir) =>
    listSourceFiles(dir).flatMap((file) =>
      collectSpecifiers(file)
        .filter(({ specifier }) => isParentRelative(specifier))
        .map(
          ({ line, specifier }) =>
            `${path.relative(apiDir, file).split(path.sep).join("/")}:${line} ${specifier}`,
        ),
    ),
  );

export const findUnresolvedAliases = (
  dirs: string[],
  root = srcRoot,
): string[] =>
  dirs.flatMap((dir) =>
    listSourceFiles(dir).flatMap((file) =>
      collectSpecifiers(file)
        .filter(
          ({ specifier }) =>
            specifier.startsWith("@/") && !resolveAlias(specifier, root),
        )
        .map(
          ({ line, specifier }) =>
            `${path.relative(apiDir, file).split(path.sep).join("/")}:${line} ${specifier}`,
        ),
    ),
  );
