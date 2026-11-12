import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeTableAccess,
  moduleNames,
  srcDir,
  type Edge,
} from "./table-access.js";
import { tableAccessAllowlist } from "./table-access-allowlist.js";
import { tableOwners } from "./table-ownership.js";

const { edges, violations } = analyzeTableAccess((name) => tableOwners[name]);

const edgeId = (importer: string, owner: string) => `${importer} -> ${owner}`;
const allowed = new Map(
  tableAccessAllowlist.map((entry) => [
    edgeId(entry.importer, entry.owner),
    entry,
  ]),
);

const describeSites = (edge: Edge) =>
  edge.sites
    .filter((site) => edge.access === "read" || site.access === "write")
    .slice(0, 3)
    .map(
      (site) =>
        `    ${site.file}:${site.line} ${site.table}${site.ambiguous ? ` (ambiguous, treated as a write: ${site.ambiguous})` : ""}`,
    )
    .join("\n");

describe("table access", () => {
  it("finds cross-module table access to check", () => {
    expect(edges.size).toBeGreaterThan(20);
  });

  it("imports tables only by name and never re-exports them", () => {
    expect(violations).toEqual([]);
  });

  it("allows only listed cross-module table access, writes only where listed as writes", () => {
    const offending = [...edges.values()].flatMap((edge) => {
      const entry = allowed.get(edgeId(edge.importer, edge.owner));
      const header = `${edge.importer} ${edge.access}s tables owned by ${edge.owner}`;
      if (!entry) {
        return [
          `${header}:\n${describeSites(edge)}\n    use ${edge.owner}'s ${edge.owner}.public.ts, or add a reasoned entry to table-access-allowlist.ts for review`,
        ];
      }
      if (edge.access === "write" && entry.access !== "write") {
        return [
          `${header} but the allowlist entry is read-only:\n${describeSites(edge)}\n    use ${edge.owner}'s ${edge.owner}.public.ts, or change the entry to a reasoned write for review`,
        ];
      }
      return [];
    });
    expect(offending, `\n${offending.join("\n")}`).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const stale = tableAccessAllowlist.flatMap((entry) => {
      const edge = edges.get(edgeId(entry.importer, entry.owner));
      if (!edge) return [`${entry.importer} -> ${entry.owner}: no longer used`];
      if (entry.access === "write" && edge.access === "read") {
        return [
          `${entry.importer} -> ${entry.owner}: no longer writes, change it to read`,
        ];
      }
      return [];
    });
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

  it("explains every write as known debt", () => {
    expect(
      tableAccessAllowlist
        .filter(
          (entry) =>
            entry.access === "write" &&
            (!entry.knownDebt || entry.reason.trim() === ""),
        )
        .map((entry) => edgeId(entry.importer, entry.owner)),
    ).toEqual([]);
  });
});
