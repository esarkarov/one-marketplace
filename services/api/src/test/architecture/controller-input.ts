import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  isTestKey,
  listTsFiles,
  parse,
  srcDir,
  toKey,
} from "./table-access.js";

export interface InputViolation {
  line: number;
  handler: string;
  detail: string;
}

export interface ControllerInputException {
  file: string;
  handler: string;
  reason: string;
}

export const controllerInputExceptions: readonly ControllerInputException[] = [
  {
    file: "modules/meetings/controllers/meetings.controller.ts",
    handler: "dailyWebhookHandler",
    reason:
      "raw-body webhook: reads the Buffer before json parsing to check the Daily HMAC signature",
  },
];

const REQUEST_NAMES = new Set(["request", "req"]);
const INPUT_PARTS = new Set(["body", "params", "query"]);

const isControllerKey = (key: string) =>
  key.endsWith(".controller.ts") && !isTestKey(key);

const isRequestIdentifier = (node: ts.Expression) =>
  ts.isIdentifier(node) && REQUEST_NAMES.has(node.text);

const enclosingHandler = (node: ts.Node): string => {
  let current: ts.Node | undefined = node;
  let name = "<module>";
  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      ts.isVariableStatement(current.parent.parent)
    ) {
      name = current.name.text;
    } else if (ts.isFunctionDeclaration(current) && current.name) {
      name = current.name.text;
    }
    current = current.parent;
  }
  return name;
};

export const findControllerInputReads = (file: string): InputViolation[] => {
  const source = parse(file);
  const found: InputViolation[] = [];
  const record = (node: ts.Node, detail: string) =>
    found.push({
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      handler: enclosingHandler(node),
      detail,
    });

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      isRequestIdentifier(node.expression) &&
      INPUT_PARTS.has(node.name.text)
    ) {
      record(
        node,
        `${(node.expression as ts.Identifier).text}.${node.name.text}`,
      );
    } else if (
      ts.isElementAccessExpression(node) &&
      isRequestIdentifier(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      INPUT_PARTS.has(node.argumentExpression.text)
    ) {
      record(
        node,
        `${(node.expression as ts.Identifier).text}["${node.argumentExpression.text}"]`,
      );
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isRequestIdentifier(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) && INPUT_PARTS.has(key.text)) {
          record(
            element,
            `{ ${key.text} } = ${(node.initializer as ts.Identifier).text}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

export const analyzeControllerInput = (root = srcDir) => {
  const result = new Map<string, InputViolation[]>();
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (!isControllerKey(key)) continue;
    const violations = findControllerInputReads(file);
    if (violations.length > 0) result.set(key, violations);
  }
  return result;
};

export const isExempt = (
  key: string,
  violation: InputViolation,
  exceptions: readonly ControllerInputException[] = controllerInputExceptions,
) =>
  exceptions.some(
    (entry) => entry.file === key && entry.handler === violation.handler,
  );

const GET_VALIDATED_RE = /getValidated\(\s*request,\s*(\w+)\s*[,)]/g;
const ROUTE_SPREAD_RE = /validate\(\s*\{\s*\.\.\.(\w+)/g;

const collect = (
  root: string,
  matches: (key: string) => boolean,
  pattern: RegExp,
) => {
  const names = new Map<string, string>();
  for (const file of listTsFiles(root)) {
    const key = toKey(root, file);
    if (isTestKey(key) || !matches(key)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      names.set(match[1]!, key);
    }
  }
  return names;
};

export const findUnroutedSchemas = (root = srcDir) => {
  const read = collect(root, isControllerKey, GET_VALIDATED_RE);
  const routed = collect(
    root,
    (key) => key.endsWith(".route.ts"),
    ROUTE_SPREAD_RE,
  );
  return [...read].filter(([name]) => !routed.has(name));
};
