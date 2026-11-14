import ts from "typescript";
import {
  isTestKey,
  listTsFiles,
  parse,
  srcDir,
  toKey,
} from "./table-access.js";

export interface SqlViolation {
  line: number;
  kind: "drizzle-import" | "schema-import" | "query-call";
  detail: string;
}

const QUERY_METHODS = new Set([
  "select",
  "selectDistinct",
  "insert",
  "update",
  "delete",
  "execute",
]);

export const isSqlCarveOut = (key: string) =>
  key.startsWith("database/") ||
  key.startsWith("bootstrap/") ||
  isTestKey(key) ||
  key.endsWith(".schema.ts") ||
  key.endsWith(".repository.ts");

const isTypeOnlyImport = (node: ts.ImportDeclaration) => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    !!bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
};

const isDrizzleSpecifier = (specifier: string) =>
  specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/");

const isSchemaSpecifier = (specifier: string) =>
  /\.schema(\.js)?$/.test(specifier);

const rootIdentifier = (expression: ts.Expression): string | null => {
  let current: ts.Expression = expression;
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return null;
  }
};

const collectHandleNames = (source: ts.SourceFile) => {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(^|\/)database\/client(\.js)?$/.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "db") {
            names.add(element.name.text);
          }
        }
      }
    }
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      /\bDbExecutor\b/.test(node.type.getText(source))
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let grew = true;
  while (grew) {
    grew = false;
    const walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "transaction" &&
        (() => {
          const root = rootIdentifier(node.expression.expression);
          return root !== null && names.has(root);
        })()
      ) {
        for (const argument of node.arguments) {
          if (
            (ts.isArrowFunction(argument) ||
              ts.isFunctionExpression(argument)) &&
            argument.parameters[0] &&
            ts.isIdentifier(argument.parameters[0].name) &&
            !names.has(argument.parameters[0].name.text)
          ) {
            names.add(argument.parameters[0].name.text);
            grew = true;
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return names;
};

export const findSqlViolations = (file: string): SqlViolation[] => {
  const source = parse(file);
  const handles = collectHandleNames(source);
  const found: SqlViolation[] = [];
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const typeOnly = ts.isImportDeclaration(node)
        ? isTypeOnlyImport(node)
        : node.isTypeOnly;
      if (isDrizzleSpecifier(specifier) && !typeOnly) {
        found.push({
          line: lineOf(node),
          kind: "drizzle-import",
          detail: specifier,
        });
      } else if (isSchemaSpecifier(specifier) && !typeOnly) {
        found.push({
          line: lineOf(node),
          kind: "schema-import",
          detail: specifier,
        });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      QUERY_METHODS.has(node.expression.name.text)
    ) {
      const root = rootIdentifier(node.expression.expression);
      if (root !== null && handles.has(root)) {
        found.push({
          line: lineOf(node),
          kind: "query-call",
          detail: `${root}.${node.expression.name.text}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

export const analyzeRepositorySql = (root = srcDir) => {
  const result = new Map<string, SqlViolation[]>();
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (isSqlCarveOut(key)) continue;
    const violations = findSqlViolations(file);
    if (violations.length > 0) result.set(key, violations);
  }
  return result;
};

export interface PurityViolation {
  line: number;
  kind: "api-error" | "throw" | "non-sql-import" | "fetch-call";
  detail: string;
}

const isRepositoryKey = (key: string) =>
  key.endsWith(".repository.ts") && !isTestKey(key);

const NON_SQL_IMPORT =
  /(^|\/)(infrastructure|config|bootstrap)\/|(^|\/)shared\/(http|uploads|logging)\/|^node:(fs|fs\/promises|http|https|net|tls|child_process|dns)$|^(stripe|redis|amqplib|socket\.io|pino|@clerk\/.*|@imagekit\/.*)$/;

export const findRepositoryPurityViolations = (
  file: string,
): PurityViolation[] => {
  const source = parse(file);
  const found: PurityViolation[] = [];
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (/(^|\/)api-error(\.js)?$/.test(specifier)) {
        found.push({
          line: lineOf(node),
          kind: "api-error",
          detail: specifier,
        });
      } else if (NON_SQL_IMPORT.test(specifier)) {
        found.push({
          line: lineOf(node),
          kind: "non-sql-import",
          detail: specifier,
        });
      }
    }
    if (ts.isIdentifier(node) && node.text === "ApiError") {
      found.push({ line: lineOf(node), kind: "api-error", detail: "ApiError" });
    }
    if (ts.isThrowStatement(node)) {
      found.push({
        line: lineOf(node),
        kind: "throw",
        detail: node.expression.getText(source).slice(0, 60),
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      found.push({ line: lineOf(node), kind: "fetch-call", detail: "fetch" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

export const analyzeRepositoryPurity = (root = srcDir) => {
  const result = new Map<string, PurityViolation[]>();
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (!isRepositoryKey(key)) continue;
    const violations = findRepositoryPurityViolations(file);
    if (violations.length > 0) result.set(key, violations);
  }
  return result;
};
