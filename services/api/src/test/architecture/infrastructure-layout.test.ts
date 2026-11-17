import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { srcDir } from "./table-access.js";

const infrastructureDir = path.join(srcDir, "infrastructure");

const INFRASTRUCTURE_FOLDERS = [
  "auth",
  "cache",
  "events",
  "payments",
  "storage",
  "utils",
  "video",
];

const CLIENT_FILES = [
  "auth/clerk.client.ts",
  "cache/redis.client.ts",
  "events/rabbitmq.client.ts",
  "payments/stripe.client.ts",
  "storage/image-kit.client.ts",
  "video/daily.client.ts",
];

const EXTRACTED_FOLDERS = ["constants", "types", "utils"];

const FORBIDDEN_NAMES = ["helpers", "common", "misc"];

const CLIENT_PACKAGES =
  /^(stripe|redis|amqplib|amqp-connection-manager|@clerk\/.+|@imagekit\/.+)$/;

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });

const relative = (file: string) =>
  path.relative(infrastructureDir, file).split(path.sep).join("/");

const files = listFiles(infrastructureDir).map(relative);
const sourceFiles = files.filter((f) => !/\.test\.ts$/.test(f));

const valueImportsOf = (file: string): string[] => {
  const source = readFileSync(path.join(infrastructureDir, file), "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)]
    .map((match) => match[1]!)
    .filter((specifier) => CLIENT_PACKAGES.test(specifier));
};

describe("infrastructure layout", () => {
  it("contains only the approved service folders and no loose files", () => {
    const entries = readdirSync(infrastructureDir).sort();
    expect(entries).toEqual([...INFRASTRUCTURE_FOLDERS].sort());
    expect(
      entries.filter(
        (e) => !statSync(path.join(infrastructureDir, e)).isDirectory(),
      ),
    ).toEqual([]);
  });

  it("every third-party client file is <service>.client.ts in its service folder", () => {
    const clients = sourceFiles.filter((f) => f.endsWith(".client.ts")).sort();
    expect(clients).toEqual([...CLIENT_FILES].sort());
    const misplaced = clients.filter((f) => f.split("/").length !== 2);
    expect(misplaced).toEqual([]);
  });

  it("only .client.ts files import a third-party client package", () => {
    const offending = sourceFiles.filter(
      (f) => !f.endsWith(".client.ts") && valueImportsOf(f).length > 0,
    );
    expect(offending).toEqual([]);
  });

  it("constants, types and utils hold only suffixed files", () => {
    const wrong = files.filter((f) => {
      const parts = f.split("/");
      const folderIndex = parts.findIndex((p) => EXTRACTED_FOLDERS.includes(p));
      if (folderIndex < 0) return false;
      const folder = parts[folderIndex]!;
      const name = parts[parts.length - 1]!;
      if (parts.length !== folderIndex + 2) return true;
      if (folder === "constants") return !/\.constants\.ts$/.test(name);
      if (folder === "types") return !/\.types\.ts$/.test(name);
      return !/\.utils(\.test)?\.ts$/.test(name);
    });
    expect(wrong).toEqual([]);
  });

  it("service folders nest only constants, types and utils", () => {
    const wrong = files.filter((f) => {
      const parts = f.split("/");
      if (parts[0] === "utils") return parts.length !== 2;
      if (parts.length === 2) return false;
      return parts.length !== 3 || !EXTRACTED_FOLDERS.includes(parts[1]!);
    });
    expect(wrong).toEqual([]);
  });

  it("every test sits next to the file it tests", () => {
    const stray = files
      .filter((f) => f.endsWith(".test.ts"))
      .filter(
        (f) => !files.includes(f.replace(/(\.integration)?\.test\.ts$/, ".ts")),
      );
    expect(stray).toEqual([]);
  });

  it("no file is named helpers, common or misc", () => {
    const offending = files.filter((f) => {
      const name = path.posix.basename(f).replace(/\.[^.]+$/, "");
      return FORBIDDEN_NAMES.includes(name);
    });
    expect(offending).toEqual([]);
  });

  it("has no barrel index.ts", () => {
    expect(files.filter((f) => f.endsWith("index.ts"))).toEqual([]);
  });
});
