import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const srcDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export type Access = "read" | "write";

export interface Site {
  file: string;
  line: number;
  table: string;
  access: Access;
  ambiguous?: string;
}

export interface Edge {
  importer: string;
  owner: string;
  access: Access;
  sites: Site[];
}

export interface TableDefinition {
  name: string;
  kind: "table" | "enum";
  file: string;
}

const toKey = (file: string) =>
  path.relative(srcDir, file).split(path.sep).join("/");

const listTsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listTsFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });

const parse = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

const isModuleTableFile = (key: string) =>
  /^modules\/[^/]+\/[^/]+\.schema\.ts$/.test(key);

const isTableSource = (key: string) =>
  key === "database/schema.ts" ||
  key.startsWith("database/schema/") ||
  isModuleTableFile(key);

const isTestKey = (key: string) =>
  key.endsWith(".test.ts") || key.startsWith("test/");

const resolveImport = (from: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

export const moduleNames = (): string[] =>
  readdirSync(path.join(srcDir, "modules")).filter((entry) =>
    statSync(path.join(srcDir, "modules", entry)).isDirectory(),
  );

export const discoverTableDefinitions = (): TableDefinition[] => {
  const files = listTsFiles(srcDir).filter((file) => {
    const key = toKey(file);
    return key.startsWith("database/schema/") || isModuleTableFile(key);
  });
  const definitions: TableDefinition[] = [];
  for (const file of files) {
    for (const statement of parse(file).statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const exported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!exported) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          !ts.isIdentifier(declaration.name) ||
          !init ||
          !ts.isCallExpression(init) ||
          !ts.isIdentifier(init.expression)
        ) {
          continue;
        }
        const callee = init.expression.text;
        if (callee === "pgTable" || callee === "pgEnum") {
          definitions.push({
            name: declaration.name.text,
            kind: callee === "pgTable" ? "table" : "enum",
            file: toKey(file),
          });
        }
      }
    }
  }
  return definitions;
};

export const importerKeyOf = (key: string): string => {
  const match = /^modules\/([^/]+)\//.exec(key);
  return match ? match[1]! : path.posix.dirname(key);
};

const MEMBER_NAME_PARENTS = [
  ts.isPropertyAccessExpression,
  ts.isPropertyAssignment,
  ts.isPropertySignature,
  ts.isPropertyDeclaration,
  ts.isMethodDeclaration,
  ts.isEnumMember,
] as const;

const isDeclarationName = (node: ts.Identifier) => {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  );
};

const JOIN_CALLEES = new Set([
  "from",
  "innerJoin",
  "leftJoin",
  "rightJoin",
  "fullJoin",
  "crossJoin",
]);
const RAW_SQL_TABLE =
  /\b(insert\s+into|update|delete\s+from|from|join)\s+"?([a-z_]+)"?/gi;
const WRITE_CALLEES = new Set(["insert", "update", "delete"]);

const calleeName = (call: ts.CallExpression): string | null =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : null;

interface Classified {
  access: Access;
  ambiguous?: string;
}

const classifyUse = (node: ts.Identifier): Classified | null => {
  const parent = node.parent;
  for (const guard of MEMBER_NAME_PARENTS) {
    if (guard(parent) && "name" in parent && parent.name === node) return null;
  }
  if (ts.isQualifiedName(parent) && parent.right === node) return null;
  if (isDeclarationName(node)) return null;
  if (ts.isImportSpecifier(parent)) return null;

  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return { access: "read" };
  }
  if (ts.isQualifiedName(parent) && parent.left === node) {
    return { access: "read" };
  }
  if (ts.isTypeQueryNode(parent)) return { access: "read" };
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = calleeName(parent);
    if (callee && WRITE_CALLEES.has(callee)) return { access: "write" };
    if (callee && JOIN_CALLEES.has(callee)) return { access: "read" };
  }
  if (
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    ts.isShorthandPropertyAssignment(parent)
  ) {
    let container: ts.Node = parent.parent;
    while (ts.isObjectLiteralExpression(container) && container.parent) {
      if (!ts.isObjectLiteralExpression(container.parent)) break;
      container = container.parent;
    }
    const call = container.parent;
    if (
      ts.isCallExpression(call) &&
      call.arguments[0] === container &&
      ["select", "selectDistinct"].includes(calleeName(call) ?? "")
    ) {
      return { access: "read" };
    }
  }
  if (ts.isTemplateSpan(parent) && parent.expression === node) {
    const template = parent.parent;
    const index = template.templateSpans.indexOf(parent);
    const before = (
      index === 0
        ? template.head.text
        : template.templateSpans[index - 1]!.literal.text
    ).trimEnd();
    if (/(insert\s+into|update|delete\s+from)$/i.test(before)) {
      return { access: "write" };
    }
    if (/(from|join)$/i.test(before)) return { access: "read" };
  }
  return {
    access: "write",
    ambiguous: `table used as a value in ${ts.SyntaxKind[parent.kind]}: ${parent.getText().replace(/\s+/g, " ").slice(0, 80)}`,
  };
};

export const analyzeTableAccess = (
  ownerOf: (name: string) => string | undefined,
) => {
  const violations: string[] = [];
  const sites: (Site & { importer: string })[] = [];

  const files = listTsFiles(srcDir).filter((file) => {
    const key = toKey(file);
    return (
      !isTestKey(key) && !key.startsWith("database/") && !isModuleTableFile(key)
    );
  });

  for (const file of files) {
    const key = toKey(file);
    const importer = importerKeyOf(key);
    const source = parse(file);
    const locals = new Map<string, string>();
    const lineOf = (node: ts.Node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    const targetOf = (specifier: ts.Expression | undefined) => {
      if (!specifier || !ts.isStringLiteralLike(specifier)) return null;
      const resolved = resolveImport(file, specifier.text);
      return resolved && isTableSource(toKey(resolved)) ? resolved : null;
    };

    const visitImports = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && targetOf(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        if (
          !clause ||
          clause.name ||
          !bindings ||
          !ts.isNamedImports(bindings)
        ) {
          violations.push(
            `${key}:${lineOf(node)} imports tables with a default, namespace or side-effect import; use named imports`,
          );
        } else {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (!ownerOf(imported)) {
              violations.push(
                `${key}:${lineOf(element)} imports "${imported}" from the schema, which has no owner in table-ownership.ts`,
              );
              continue;
            }
            locals.set(element.name.text, imported);
          }
        }
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        targetOf(node.moduleSpecifier)
      ) {
        violations.push(
          `${key}:${lineOf(node)} re-exports tables; only table files may do that`,
        );
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        targetOf(node.arguments[0])
      ) {
        violations.push(
          `${key}:${lineOf(node)} dynamically imports tables; use a named static import`,
        );
      }
      ts.forEachChild(node, visitImports);
    };
    visitImports(source);

    const visitRawSql = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        for (const match of node.text.matchAll(RAW_SQL_TABLE)) {
          const table = match[2]!;
          if (!ownerOf(table)) continue;
          sites.push({
            importer,
            file: key,
            line: lineOf(node),
            table,
            access: /^(insert|update|delete)/i.test(match[1]!)
              ? "write"
              : "read",
          });
        }
      }
      ts.forEachChild(node, visitRawSql);
    };
    ts.forEachChild(source, (child) => {
      if (!ts.isImportDeclaration(child)) visitRawSql(child);
    });

    if (locals.size === 0) continue;

    const visitUses = (node: ts.Node) => {
      if (ts.isIdentifier(node) && locals.has(node.text)) {
        const classified = classifyUse(node);
        if (classified) {
          sites.push({
            importer,
            file: key,
            line: lineOf(node),
            table: locals.get(node.text)!,
            access: classified.access,
            ambiguous: classified.ambiguous,
          });
        }
      }
      ts.forEachChild(node, visitUses);
    };
    ts.forEachChild(source, (child) => {
      if (!ts.isImportDeclaration(child)) visitUses(child);
    });
  }

  const edges = new Map<string, Edge>();
  for (const site of sites) {
    const owner = ownerOf(site.table)!;
    if (owner === site.importer) continue;
    const id = `${site.importer} -> ${owner}`;
    const edge = edges.get(id) ?? {
      importer: site.importer,
      owner,
      access: "read" as Access,
      sites: [],
    };
    if (site.access === "write") edge.access = "write";
    edge.sites.push(site);
    edges.set(id, edge);
  }
  return { edges, violations };
};
