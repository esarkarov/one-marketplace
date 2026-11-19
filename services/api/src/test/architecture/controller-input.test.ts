import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeControllerInput,
  controllerInputExceptions,
  findUnroutedSchemas,
  isExempt,
} from "./controller-input.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "controller-input-"));
  roots.push(root);
  for (const [key, content] of Object.entries(files)) {
    const file = path.join(root, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

describe("controllers read validated input only", () => {
  const found = analyzeControllerInput();

  it("has no direct request.body, params or query read outside the exception list", () => {
    const offending = [...found].flatMap(([key, violations]) =>
      violations
        .filter((violation) => !isExempt(key, violation))
        .map((violation) => `${key}:${violation.line} ${violation.detail}`),
    );
    expect(
      offending,
      "read validated input with getValidated(request, <schemas>) from middleware/utils/validated-request.utils.ts",
    ).toEqual([]);
  });

  it("spreads every schemas constant a controller reads into a route's validate", () => {
    expect(
      findUnroutedSchemas().map(([name, key]) => `${key} reads ${name}`),
      "define the constant once in schemas/ and use validate({ ...<route>Request, responses }) in the route",
    ).toEqual([]);
  });

  it("flags a controller schemas constant that no route spreads into validate", () => {
    const root = tree({
      "modules/a/controllers/a.controller.ts": `
export const one = async (request: any) => {
  const { query } = getValidated(request, aRequest);
  const { body } = getValidated(request, bRequest);
};
`,
      "modules/a/a.route.ts": `
router.get("/", validate({ ...aRequest, responses: x }), one);
`,
    });
    expect(findUnroutedSchemas(root)).toEqual([
      ["bRequest", "modules/a/controllers/a.controller.ts"],
    ]);
  });

  it("keeps every exception entry in use and documented", () => {
    for (const entry of controllerInputExceptions) {
      expect(entry.reason.length).toBeGreaterThan(10);
      const violations = found.get(entry.file) ?? [];
      expect(
        violations.some((violation) => violation.handler === entry.handler),
        `${entry.file} ${entry.handler} no longer reads request input; remove the exception`,
      ).toBe(true);
    }
  });

  it("flags direct reads, optional chains, element access and destructuring", () => {
    const root = tree({
      "modules/a/controllers/a.controller.ts": `
export const one = async (request: any) => {
  const id = request.params.id;
  const name = request?.body?.name;
  const page = request["query"].page;
  const { body } = request;
  const { query: q } = req;
  return [id, name, page, body, q];
};
`,
    });
    const result = analyzeControllerInput(root).get(
      "modules/a/controllers/a.controller.ts",
    )!;
    expect(result.map((v) => v.detail)).toEqual([
      "request.params",
      "request.body",
      'request["query"]',
      "{ body } = request",
      "{ query } = req",
    ]);
    expect(new Set(result.map((v) => v.handler))).toEqual(new Set(["one"]));
  });

  it("ignores validated reads, other request fields, tests and non-controllers", () => {
    const root = tree({
      "modules/a/controllers/a.controller.ts": `
export const ok = async (request: any) => {
  const { params } = getValidated(request, schemas);
  return [params, request.auth, request.headers, request.logger];
};
`,
      "modules/a/controllers/a.controller.test.ts": `
export const t = (request: any) => request.body;
`,
      "modules/a/services/a.service.ts": `
export const s = (request: any) => request.body;
`,
    });
    expect(analyzeControllerInput(root).size).toBe(0);
  });

  it("scopes an exception to its handler, not the whole file", () => {
    const root = tree({
      "modules/m/controllers/m.controller.ts": `
export const rawHandler = async (request: any) => request.body;
export const otherHandler = async (request: any) => request.params;
`,
    });
    const key = "modules/m/controllers/m.controller.ts";
    const violations = analyzeControllerInput(root).get(key)!;
    const exceptions = [
      { file: key, handler: "rawHandler", reason: "raw body" },
    ];
    expect(violations.map((v) => isExempt(key, v, exceptions))).toEqual([
      true,
      false,
    ]);
  });
});
