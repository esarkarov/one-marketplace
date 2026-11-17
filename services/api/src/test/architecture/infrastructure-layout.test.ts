import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { srcDir } from "./table-access.js";

const infrastructureDir = path.join(srcDir, "infrastructure");

const SERVICE_FOLDERS = [
  "auth",
  "cache",
  "events",
  "payments",
  "storage",
  "video",
];

const SHARED_FOLDERS = ["constants", "types", "utils"];

const INFRASTRUCTURE_FOLDERS = [...SERVICE_FOLDERS, ...SHARED_FOLDERS];

const BARREL_FOLDERS = ["constants", "types"];

const CLIENT_FILES = [
  "auth/clerk.client.ts",
  "cache/redis.client.ts",
  "events/rabbitmq.client.ts",
  "payments/stripe.client.ts",
  "storage/image-kit.client.ts",
  "video/daily.client.ts",
];

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

const SHARED_SUFFIX: Record<string, RegExp> = {
  constants: /^(index|.+\.constants)\.ts$/,
  types: /^(index|.+\.types)\.ts$/,
  utils: /^.+\.utils(\.test)?\.ts$/,
};

describe("infrastructure layout", () => {
  it("contains only the approved folders and no loose files", () => {
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
    const misplaced = clients.filter(
      (f) => !SERVICE_FOLDERS.includes(f.split("/")[0]!),
    );
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
      const [folder, name] = f.split("/") as [string, string];
      const suffix = SHARED_SUFFIX[folder];
      return suffix ? !suffix.test(name) : false;
    });
    expect(wrong).toEqual([]);
  });

  it("every folder holds files directly and nests nothing", () => {
    expect(files.filter((f) => f.split("/").length !== 2)).toEqual([]);
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

  it("index.ts exists only in constants/ and types/", () => {
    const misplaced = files.filter(
      (f) =>
        f.endsWith("index.ts") && !BARREL_FOLDERS.includes(f.split("/")[0]!),
    );
    expect(misplaced).toEqual([]);
  });
});
