import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeTableAccess,
  discoverTableDefinitions,
} from "./table-access.js";
import {
  checkTableFiles,
  findDatabaseModuleImports,
  findTableFileCycles,
  isTableFile,
  tableFileOf,
} from "./table-files.js";
import { tableOwners } from "./table-ownership.js";

const roots: string[] = [];

const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "table-files-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const table = (name: string) =>
  `import { pgTable, text } from "drizzle-orm/pg-core";\nexport const ${name} = pgTable("${name}", { id: text("id") });\n`;

describe("table file naming", () => {
  it("accepts only modules/<name>/<name>.schema.ts", () => {
    expect(isTableFile("modules/auth/auth.schema.ts")).toBe(true);
    expect(isTableFile("modules/auth/accounts.schema.ts")).toBe(false);
    expect(isTableFile("modules/auth/auth.schemas.ts")).toBe(false);
    expect(isTableFile("database/schema.ts")).toBe(false);
    expect(isTableFile("modules/auth/tests/auth.schema.ts")).toBe(false);
  });

  it("flags a misnamed or misplaced table file", () => {
    const root = tree({
      "modules/a/b.schema.ts": table("t1"),
      "database/x.schema.ts": table("t2"),
    });
    const problems = checkTableFiles(root);
    expect(problems.some((p) => p.startsWith("modules/a/b.schema.ts:"))).toBe(
      true,
    );
    expect(problems.some((p) => p.startsWith("database/x.schema.ts:"))).toBe(
      true,
    );
  });

  it("flags a table or enum defined outside a table file", () => {
    const root = tree({ "modules/a/a.service.ts": table("t3") });
    expect(checkTableFiles(root)).toEqual([
      "modules/a/a.service.ts: defines t3; tables and enums are defined only in table files",
    ]);
  });

  it("defines every table and enum in its owner's table file", () => {
    expect(
      discoverTableDefinitions()
        .filter(
          (definition) =>
            definition.file !== tableFileOf(tableOwners[definition.name]!),
        )
        .map((definition) => `${definition.name} in ${definition.file}`),
    ).toEqual([]);
  });

  it("has only well-formed table files in the source tree", () => {
    expect(checkTableFiles()).toEqual([]);
  });
});

describe("table file imports", () => {
  it("allows drizzle-orm packages and other table files", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a"),
      "modules/b/b.schema.ts": `import { sql } from "drizzle-orm";\nimport { a } from "../a/a.schema.js";\n${table("b")}export const bExpr = sql\`\${a}\`;\n`,
    });
    expect(checkTableFiles(root)).toEqual([]);
  });

  it("flags config, shared, client and package imports", () => {
    const root = tree({
      "config/env.ts": "export const env = {};\n",
      "modules/a/a.service.ts": "export const service = 1;\n",
      "modules/a/a.schema.ts": `import { env } from "../../config/env.js";\nimport { z } from "zod";\nimport { service } from "./a.service.js";\n${table("a")}`,
    });
    const problems = checkTableFiles(root);
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.startsWith("modules/a/a.schema.ts:"))).toBe(
      true,
    );
  });
});

describe("table file cycles", () => {
  it("detects a cycle among table files", () => {
    const root = tree({
      "modules/a/a.schema.ts": `import { b } from "../b/b.schema.js";\n${table("a")}`,
      "modules/b/b.schema.ts": `import { a } from "../a/a.schema.js";\n${table("b")}`,
    });
    expect(findTableFileCycles(root)).toEqual([
      "modules/a/a.schema.ts -> modules/b/b.schema.ts -> modules/a/a.schema.ts",
    ]);
  });

  it("accepts a chain of table files", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a"),
      "modules/b/b.schema.ts": `import { a } from "../a/a.schema.js";\n${table("b")}`,
      "modules/c/c.schema.ts": `import { a } from "../a/a.schema.js";\nimport { b } from "../b/b.schema.js";\n${table("c")}`,
    });
    expect(findTableFileCycles(root)).toEqual([]);
  });

  it("has no cycle among the real table files", () => {
    expect(findTableFileCycles()).toEqual([]);
  });
});

describe("table access across table files", () => {
  const owners = (name: string) =>
    ({ a_table: "a", b_table: "b" })[name as "a_table"];

  it("detects a read and a write through a module table file", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a_table"),
      "modules/b/b.schema.ts": table("b_table"),
      "modules/b/b.service.ts": `import { a_table } from "../a/a.schema.js";\nimport { b_table } from "./b.schema.js";\nexport const run = (db: any) => {\n  db.select().from(a_table);\n  db.insert(b_table);\n};\n`,
      "modules/c/c.service.ts": `import { a_table } from "../a/a.schema.js";\nexport const run = (tx: any) => tx.update(a_table);\n`,
    });
    const { edges, violations } = analyzeTableAccess(owners, root);
    expect(violations).toEqual([]);
    expect(
      [...edges.values()].map(
        (edge) => `${edge.importer} -> ${edge.owner} ${edge.access}`,
      ),
    ).toEqual(["b -> a read", "c -> a write"]);
  });

  it("ignores access by the owning module and by table files", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a_table"),
      "modules/a/a.service.ts": `import { a_table } from "./a.schema.js";\nexport const run = (db: any) => db.insert(a_table);\n`,
    });
    expect(analyzeTableAccess(owners, root).edges.size).toBe(0);
  });

  it("flags a namespace import and a re-export of a table file", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a_table"),
      "modules/b/b.service.ts": `import * as schema from "../a/a.schema.js";\nexport { a_table } from "../a/a.schema.js";\nexport const run = schema;\n`,
    });
    expect(analyzeTableAccess(owners, root).violations).toHaveLength(2);
  });
});

describe("database imports", () => {
  it("flags a database file that imports a module file", () => {
    const root = tree({
      "modules/a/a.schema.ts": table("a_table"),
      "database/client.ts": "export const db = 1;\n",
      "database/aggregate.ts": `export * from "../modules/a/a.schema.js";\n`,
    });
    expect(findDatabaseModuleImports(root)).toEqual([
      "database/aggregate.ts imports modules/a/a.schema.ts; database/ imports no module files",
    ]);
  });

  it("has no database file importing a module file", () => {
    expect(findDatabaseModuleImports()).toEqual([]);
  });
});
