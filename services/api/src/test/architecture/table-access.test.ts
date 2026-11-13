import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeTableAccess,
  moduleNames,
  srcDir,
  type Edge,
} from "./table-access.js";
import {
  tableAccessAllowlist,
  type TableAccessEntry,
} from "./table-access-allowlist.js";
import { tableOwners } from "./table-ownership.js";

const { edges, violations } = analyzeTableAccess((name) => tableOwners[name]);

const edgeId = (importer: string, owner: string) => `${importer} -> ${owner}`;
const toAllowedMap = (entries: TableAccessEntry[]) =>
  new Map(entries.map((entry) => [edgeId(entry.importer, entry.owner), entry]));
const allowed = toAllowedMap(tableAccessAllowlist);

const describeSites = (edge: Edge) =>
  edge.sites
    .filter((site) => edge.access === "read" || site.access === "write")
    .slice(0, 3)
    .map(
      (site) =>
        `    ${site.file}:${site.line} ${site.table}${site.ambiguous ? ` (ambiguous, treated as a write: ${site.ambiguous})` : ""}`,
    )
    .join("\n");

const offendingEdges = (
  found: Edge[],
  entries: Map<string, TableAccessEntry>,
) =>
  found.flatMap((edge) => {
    const entry = entries.get(edgeId(edge.importer, edge.owner));
    const header = `${edge.importer} ${edge.access}s tables owned by ${edge.owner}`;
    if (!entry) {
      return [
        `${header}:\n${describeSites(edge)}\n    use ${edge.owner}'s ${edge.owner}.public.ts, or add a reasoned entry to table-access-allowlist.ts for review`,
      ];
    }
    if (edge.access === "write") {
      return [
        `${header}:\n${describeSites(edge)}\n    cross-module writes must go through ${edge.owner}'s ${edge.owner}.public.ts`,
      ];
    }
    return [];
  });

describe("table access", () => {
  it("finds cross-module table access to check", () => {
    expect(edges.size).toBeGreaterThan(20);
  });

  it("imports tables only by name and never re-exports them", () => {
    expect(violations).toEqual([]);
  });

  it("allows only listed cross-module reads and no cross-module writes", () => {
    const offending = offendingEdges([...edges.values()], allowed);
    expect(offending, `\n${offending.join("\n")}`).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const stale = tableAccessAllowlist.flatMap((entry) =>
      edges.has(edgeId(entry.importer, entry.owner))
        ? []
        : [`${entry.importer} -> ${entry.owner}: no longer used`],
    );
    expect(stale).toEqual([]);
  });

  it("lists each edge once, with real importers and owners", () => {
    const modules = new Set(moduleNames());
    const ids = tableAccessAllowlist.map((entry) =>
      edgeId(entry.importer, entry.owner),
    );
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    expect(
      tableAccessAllowlist
        .filter(
          (entry) =>
            !modules.has(entry.owner) ||
            (!modules.has(entry.importer) &&
              !existsSync(path.join(srcDir, entry.importer))),
        )
        .map((entry) => edgeId(entry.importer, entry.owner)),
    ).toEqual([]);
  });

  it("cannot express a write entry", () => {
    const entry: TableAccessEntry = {
      importer: "a",
      owner: "b",
      // @ts-expect-error the allowlist type has no write access
      access: "write",
    };
    expect(entry.access).toBe("write");
  });

  it("rejects a detected write edge even when a read entry exists", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "table-access-"));
    try {
      const put = (key: string, content: string) => {
        const file = path.join(root, key);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
      };
      put(
        "modules/owner/owner.schema.ts",
        'import { pgTable, uuid } from "drizzle-orm/pg-core";\nexport const things = pgTable("things", { id: uuid("id") });\n',
      );
      put(
        "modules/importer/importer.service.ts",
        'import { db } from "../../database/client.js";\nimport { things } from "../owner/owner.schema.js";\nexport const touch = () => db.update(things).set({});\n',
      );
      const found = analyzeTableAccess(
        (name) => (name === "things" ? "owner" : undefined),
        root,
      );
      const edge = found.edges.get(edgeId("importer", "owner"));
      expect(edge?.access).toBe("write");
      const readEntry: TableAccessEntry = {
        importer: "importer",
        owner: "owner",
        access: "read",
      };
      expect(
        offendingEdges([...found.edges.values()], toAllowedMap([readEntry])),
      ).toHaveLength(1);
      expect(offendingEdges([...found.edges.values()], new Map())).toHaveLength(
        1,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
