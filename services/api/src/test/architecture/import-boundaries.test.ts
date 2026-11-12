import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boundaryExceptions } from "./boundary-exceptions.js";

const srcDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const infrastructureDirs = [
  "config",
  "infrastructure",
  "shared",
  "database",
  "types",
  "openapi",
];

const moduleLayers: Record<string, number> = {
  admin: 0,
  auth: 0,
  client: 0,
  identity: 0,
  jobs: 0,
  payouts: 0,
  connects: 0,
  freelancer: 1,
  agency: 2,
  messaging: 3,
  meetings: 4,
  notifications: 4,
  proposals: 4,
  contracts: 5,
};

interface Edge {
  importer: string;
  imported: string;
}

const importPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function toKey(file: string): string {
  return path.relative(srcDir, file).split(path.sep).join("/");
}

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    path.join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function collectEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const file of listSourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const target = resolveImport(file, match[1]!);
      if (target)
        edges.push({ importer: toKey(file), imported: toKey(target) });
    }
  }
  return edges;
}

function moduleOf(key: string): string | null {
  const match = /^modules\/([^/]+)\//.exec(key);
  return match ? match[1]! : null;
}

function topDirOf(key: string): string {
  return key.split("/")[0]!;
}

function isTestFile(key: string): boolean {
  return key.endsWith(".test.ts") || key.startsWith("test/");
}

type Rule = "module-boundary" | "module-layer" | "infrastructure-direction";

function violationRules(edge: Edge): Rule[] {
  const importerModule = moduleOf(edge.importer);
  if (isTestFile(edge.importer)) return [];
  const importedModule = moduleOf(edge.imported);
  if (!importedModule) return [];
  if (importerModule && importerModule !== importedModule) {
    const rules: Rule[] = [];
    if (
      edge.imported !== `modules/${importedModule}/${importedModule}.public.ts`
    ) {
      rules.push("module-boundary");
    }
    const importerLayer = moduleLayers[importerModule];
    const importedLayer = moduleLayers[importedModule];
    if (
      importerLayer === undefined ||
      importedLayer === undefined ||
      importedLayer >= importerLayer
    ) {
      rules.push("module-layer");
    }
    return rules;
  }
  if (!importerModule && infrastructureDirs.includes(topDirOf(edge.importer))) {
    return ["infrastructure-direction"];
  }
  return [];
}

const pairKey = (edge: Edge) => `${edge.importer} -> ${edge.imported}`;

const edges = collectEdges();
const violations = edges.flatMap((edge) =>
  violationRules(edge).map((rule) => ({ edge, rule })),
);
const exceptionKeys = new Set(boundaryExceptions.map(pairKey));

function findCycles(graph: Map<string, Set<string>>): string[][] {
  const nodes = [...graph.keys()].sort();
  const cycles: string[][] = [];
  for (const [startIndex, start] of nodes.entries()) {
    const allowed = new Set(nodes.slice(startIndex));
    const walk = (node: string, trail: string[]) => {
      for (const next of [...(graph.get(node) ?? [])].sort()) {
        if (!allowed.has(next)) continue;
        if (next === start) {
          cycles.push([...trail, start]);
        } else if (!trail.includes(next)) {
          walk(next, [...trail, next]);
        }
      }
    };
    walk(start, [start]);
  }
  return cycles;
}

describe("import boundaries", () => {
  it("resolves a meaningful number of imports", () => {
    expect(edges.length).toBeGreaterThan(100);
  });

  it("module-boundary: modules do not import other modules", () => {
    const offending = violations
      .filter((v) => v.rule === "module-boundary")
      .map((v) => pairKey(v.edge))
      .filter((key) => !exceptionKeys.has(key));
    expect([...new Set(offending)].join("\n")).toBe("");
  });

  it("infrastructure-direction: shared code does not import modules", () => {
    const offending = violations
      .filter((v) => v.rule === "infrastructure-direction")
      .map((v) => pairKey(v.edge))
      .filter((key) => !exceptionKeys.has(key));
    expect([...new Set(offending)].join("\n")).toBe("");
  });

  it("controller-database: controllers and routes do not import the database", () => {
    const offending = edges
      .filter(
        ({ importer, imported }) =>
          /^modules\/[^/]+\/[^/]+\.(controller|route)\.ts$/.test(importer) &&
          topDirOf(imported) === "database",
      )
      .map(pairKey);
    expect(offending).toEqual([]);
  });

  it("stale-exceptions: every exception matches a real violating import", () => {
    const violating = new Set(violations.map((v) => pairKey(v.edge)));
    const stale = boundaryExceptions
      .map(pairKey)
      .filter((key) => !violating.has(key));
    expect(stale).toEqual([]);
  });

  it("exceptions have a reason and are unique", () => {
    const keys = boundaryExceptions.map(pairKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(boundaryExceptions.filter((e) => e.reason.trim() === "")).toEqual(
      [],
    );
  });

  it("module-cycles: the module dependency graph has no cycles", () => {
    const graph = new Map<string, Set<string>>();
    const edgeFiles = new Map<string, Set<string>>();
    for (const { importer, imported } of edges) {
      if (isTestFile(importer)) continue;
      const from = moduleOf(importer);
      const to = moduleOf(imported);
      if (!from || !to || from === to) continue;
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from)!.add(to);
      const key = `${from} -> ${to}`;
      if (!edgeFiles.has(key)) edgeFiles.set(key, new Set());
      edgeFiles.get(key)!.add(`${importer} -> ${imported}`);
    }
    const cycles = findCycles(graph).map((cycle) => {
      const steps = cycle
        .slice(0, -1)
        .map((node, i) => `${node} -> ${cycle[i + 1]}`);
      return [
        cycle.join(" -> "),
        ...steps.flatMap((step) =>
          [...(edgeFiles.get(step) ?? [])].map((file) => `    ${file}`),
        ),
      ].join("\n");
    });
    expect(cycles, `\n${cycles.join("\n")}`).toEqual([]);
  });
});
