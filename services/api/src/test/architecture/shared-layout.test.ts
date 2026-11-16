import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { srcDir } from "./table-access.js";

const sharedDir = path.join(srcDir, "shared");
const middlewareDir = path.join(srcDir, "middleware");

const SHARED_FOLDERS = [
  "errors",
  "ids",
  "logging",
  "money",
  "responses",
  "uploads",
  "validation",
];

const MIDDLEWARE_FOLDERS = [
  "auth",
  "constants",
  "error",
  "http-logger",
  "json-body",
  "not-found",
  "rate-limit",
  "request-id",
  "types",
  "utils",
  "validate",
];

const FORBIDDEN_NAMES = ["helpers", "common", "misc"];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const relative = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

const sharedFiles = listFiles(sharedDir).map((f) => relative(sharedDir, f));
const middlewareFiles = listFiles(middlewareDir).map((f) =>
  relative(middlewareDir, f),
);

describe("shared and middleware layout", () => {
  it("shared/ has no http directory", () => {
    expect(existsSync(path.join(sharedDir, "http"))).toBe(false);
  });

  it("shared/ contains only the approved top-level folders and no loose files", () => {
    const entries = readdirSync(sharedDir).sort();
    expect(entries).toEqual([...SHARED_FOLDERS].sort());
    expect(
      entries.filter((e) => !statSync(path.join(sharedDir, e)).isDirectory()),
    ).toEqual([]);
  });

  it("middleware/ contains only the approved folders and no loose files", () => {
    const entries = readdirSync(middlewareDir).sort();
    expect(entries).toEqual([...MIDDLEWARE_FOLDERS].sort());
    expect(
      entries.filter(
        (e) => !statSync(path.join(middlewareDir, e)).isDirectory(),
      ),
    ).toEqual([]);
  });

  it("every *.middleware.ts lives in middleware/<name>/ with its test", () => {
    const middlewares = middlewareFiles.filter((f) =>
      f.endsWith(".middleware.ts"),
    );
    expect(middlewares.length).toBeGreaterThan(0);
    const misplaced = middlewares.filter((f) => f.split("/").length !== 2);
    expect(misplaced).toEqual([]);

    const strayTests = middlewareFiles.filter((f) => {
      if (!f.endsWith(".middleware.test.ts")) return false;
      const sibling = f.replace(/\.test\.ts$/, ".ts");
      return !middlewareFiles.includes(sibling);
    });
    expect(strayTests).toEqual([]);
  });

  it("middleware/constants, types and utils hold only suffixed files", () => {
    const wrong = middlewareFiles.filter((f) => {
      const [folder, name] = f.split("/") as [string, string];
      if (folder === "constants") return !/\.constants\.ts$/.test(name);
      if (folder === "types") return !/\.types\.ts$/.test(name);
      if (folder === "utils") return !/\.utils(\.test)?\.ts$/.test(name);
      return false;
    });
    expect(wrong).toEqual([]);
  });

  it("no file is named helpers, common or misc", () => {
    const offending = [
      ...sharedFiles.map((f) => `shared/${f}`),
      ...middlewareFiles.map((f) => `middleware/${f}`),
    ].filter((f) => {
      const name = path.posix.basename(f).replace(/\.[^.]+$/, "");
      return FORBIDDEN_NAMES.includes(name);
    });
    expect(offending).toEqual([]);
  });

  it("shared/ and middleware/ have no barrel index.ts", () => {
    const barrels = [
      ...sharedFiles.filter((f) => f.endsWith("index.ts")),
      ...middlewareFiles.filter((f) => f.endsWith("index.ts")),
    ];
    expect(barrels).toEqual([]);
  });
});
