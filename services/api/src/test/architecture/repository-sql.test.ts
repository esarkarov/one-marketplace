import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeRepositorySql,
  staleSqlExemptions,
  unlistedSqlFiles,
} from "./repository-sql.js";
import { repositorySqlExemptions } from "./repository-sql-exemptions.js";
import { srcDir } from "./table-access.js";

const found = analyzeRepositorySql();

const SERVICE_WITH_SQL = `
import { eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { things } from "./things.schema.js";

export const rename = (id: string) =>
  db.transaction(async (transaction) => {
    await transaction.update(things).set({ name: "x" }).where(eq(things.id, id));
  });
`;

const writeTree = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "repository-sql-"));
  for (const [key, content] of Object.entries(files)) {
    const file = path.join(root, key);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const tree = (files: Record<string, string>) => {
  const root = writeTree(files);
  roots.push(root);
  return root;
};

describe("SQL lives in repositories", () => {
  it("lets only exempt files import drizzle-orm or a table file, or query through db, a transaction or an executor", () => {
    const unlisted = unlistedSqlFiles(found, repositorySqlExemptions);
    expect(
      unlisted.map((key) => {
        const first = found.get(key)![0]!;
        return `${key}:${first.line} ${first.kind} ${first.detail}`;
      }),
      "SQL belongs in <module>.repository.ts; services may use db only to open db.transaction",
    ).toEqual([]);
  });

  it("has no stale exemptions, so the list only shrinks", () => {
    expect(staleSqlExemptions(found, repositorySqlExemptions)).toEqual([]);
  });

  it("lists each exemption once, for an existing file", () => {
    expect(
      repositorySqlExemptions.filter(
        (key, index) => repositorySqlExemptions.indexOf(key) !== index,
      ),
    ).toEqual([]);
    expect(
      repositorySqlExemptions.filter(
        (key) => !existsSync(path.join(srcDir, key)),
      ),
    ).toEqual([]);
  });

  it("flags a new service that queries, in every form", () => {
    const root = tree({ "modules/things/things.service.ts": SERVICE_WITH_SQL });
    const result = analyzeRepositorySql(root);
    expect([...result.keys()]).toEqual(["modules/things/things.service.ts"]);
    expect(
      result
        .get("modules/things/things.service.ts")!
        .map((v) => v.kind)
        .sort(),
    ).toEqual(["drizzle-import", "query-call", "schema-import"]);
    expect(unlistedSqlFiles(result, repositorySqlExemptions)).toEqual([
      "modules/things/things.service.ts",
    ]);
  });

  it("flags queries on an executor parameter and on db directly", () => {
    const root = tree({
      "modules/a/a.public.ts": `
import type { DbExecutor } from "../../database/db-executor.js";
export const f = (executor: DbExecutor) => executor.insert(x).values({});
`,
      "modules/b/b.service.ts": `
import { db } from "../../database/client.js";
export const g = () => db.select().from(x);
`,
    });
    expect([...analyzeRepositorySql(root).keys()].sort()).toEqual([
      "modules/a/a.public.ts",
      "modules/b/b.service.ts",
    ]);
  });

  it("flags a re-export of a table file", () => {
    const root = tree({
      "modules/a/a.public.ts": `export { things } from "./a.schema.js";`,
    });
    expect([...analyzeRepositorySql(root).keys()]).toEqual([
      "modules/a/a.public.ts",
    ]);
  });

  it("passes a repository, a table file, database and bootstrap files, tests, and code that only opens a transaction", () => {
    const root = tree({
      "modules/things/things.repository.ts": SERVICE_WITH_SQL,
      "modules/things/things.split.repository.ts": SERVICE_WITH_SQL,
      "modules/things/things.schema.ts": `import { pgTable } from "drizzle-orm/pg-core";`,
      "database/client.ts": SERVICE_WITH_SQL,
      "bootstrap/readiness.ts": SERVICE_WITH_SQL,
      "modules/things/things.service.test.ts": SERVICE_WITH_SQL,
      "test/support/helpers.ts": SERVICE_WITH_SQL,
      "modules/things/things.service.ts": `
import type { SQL } from "drizzle-orm";
import { db } from "../../database/client.js";
import { rename } from "./things.repository.js";
const set = new Set<string>();
export const run = (id: string) =>
  db.transaction(async (transaction) => {
    set.delete(id);
    await rename(transaction, id);
  });
`,
    });
    expect([...analyzeRepositorySql(root).keys()]).toEqual([]);
  });

  it("reports an exemption for a file that is already clean as stale", () => {
    const root = tree({
      "modules/things/things.service.ts": `export const clean = () => 1;`,
    });
    const result = analyzeRepositorySql(root);
    expect(
      staleSqlExemptions(result, ["modules/things/things.service.ts"]),
    ).toEqual(["modules/things/things.service.ts"]);
  });
});
