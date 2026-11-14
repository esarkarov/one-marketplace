import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkModuleLayout } from "./module-layout.js";
import { srcDir } from "./table-access.js";

const roots: string[] = [];

const tree = (files: string[]) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "module-layout-"));
  roots.push(root);
  for (const name of files) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "export {};\n");
  }
  return root;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const valid = [
  "a/a.route.ts",
  "a/a.public.ts",
  "a/a.socket.ts",
  "a/a.cron.ts",
  "a/a.consumer.ts",
  "a/controllers/a.controller.ts",
  "a/services/a.service.ts",
  "a/services/a.sse.ts",
  "a/repositories/a.repository.ts",
  "a/models/a.model.ts",
  "a/schemas/a.schema.ts",
  "a/schemas/a.redis.schema.ts",
  "a/responses/a.responses.ts",
  "a/middleware/a.middleware.ts",
  "a/tests/a.test.ts",
  "a/types/a.types.ts",
  "a/constants/a.constants.ts",
  "a/utils/a.pdf.tsx",
  "a/utils/a.state.ts",
];

describe("module folder layout", () => {
  it("the real modules follow ADR 0016 with no exemptions", () => {
    expect(checkModuleLayout(path.join(srcDir, "modules"))).toEqual([]);
  });

  it("accepts every allowed file kind", () => {
    expect(checkModuleLayout(tree(valid))).toEqual([]);
  });

  it("rejects a service at the module root", () => {
    expect(checkModuleLayout(tree(["a/a.service.ts"]))).toEqual([
      "modules/a/a.service.ts: only a.route.ts, a.public.ts, a.socket.ts, a.cron.ts, a.consumer.ts may sit at the module root",
    ]);
  });

  it("rejects a root file of another module name or kind", () => {
    expect(
      checkModuleLayout(tree(["a/b.route.ts", "a/a.helper.ts"])),
    ).toHaveLength(2);
  });

  it("rejects a test file outside tests/", () => {
    expect(checkModuleLayout(tree(["a/services/a.service.test.ts"]))).toEqual([
      "modules/a/services/a.service.test.ts: a.service.test.ts belongs in tests/",
    ]);
    expect(checkModuleLayout(tree(["a/a.route.test.ts"]))).toHaveLength(1);
  });

  it("rejects an unknown folder", () => {
    expect(checkModuleLayout(tree(["a/helpers/a.ts"]))).toEqual([
      "modules/a/helpers/a.ts: unknown folder helpers/",
    ]);
  });

  it("rejects a repository outside repositories/", () => {
    expect(checkModuleLayout(tree(["a/services/a.repository.ts"]))).toEqual([
      "modules/a/services/a.repository.ts: a.repository.ts belongs in repositories/",
    ]);
  });

  it.each([
    ["a/a.controller.ts"],
    ["a/services/a.controller.ts"],
    ["a/a.model.ts"],
    ["a/schemas/a.model.ts"],
    ["a/a.schema.ts"],
    ["a/models/a.schema.ts"],
    ["a/a.responses.ts"],
    ["a/controllers/a.responses.ts"],
    ["a/a.middleware.ts"],
    ["a/services/a.middleware.ts"],
  ])("rejects %s", (file) => {
    expect(checkModuleLayout(tree([file]))).toHaveLength(1);
  });

  it("allows only <module>.model.ts in models/", () => {
    expect(checkModuleLayout(tree(["a/models/b.model.ts"]))).toEqual([
      "modules/a/models/b.model.ts: models/ holds only a.model.ts",
    ]);
  });

  it("rejects nested folders and mismatched names inside a folder", () => {
    expect(checkModuleLayout(tree(["a/services/x/a.service.ts"]))).toEqual([
      "modules/a/services/x/a.service.ts: folders are not nested inside services/",
    ]);
    expect(checkModuleLayout(tree(["a/controllers/a.ts"]))).toEqual([
      "modules/a/controllers/a.ts: controllers/ does not hold this file name",
    ]);
  });
});
