import { describe, expect, it } from "vitest";
import {
  tableAccessAllowlist,
  type TableAccessEntry,
} from "./table-access-allowlist.js";

const findWrites = (entries: TableAccessEntry[]) =>
  entries
    .filter((entry) => entry.access === "write")
    .map((entry) => `${entry.importer} -> ${entry.owner}`);

const explain = (writes: string[]) =>
  `cross-module writes must go through the owner's .public.ts, not the allowlist: ${writes.join(", ")}`;

describe("table access allowlist has no writes", () => {
  it("lists reads only", () => {
    const writes = findWrites(tableAccessAllowlist);
    expect(writes, explain(writes)).toEqual([]);
  });

  it("detects a write entry", () => {
    const writes = findWrites([
      ...tableAccessAllowlist,
      {
        importer: "client",
        owner: "auth",
        access: "write",
        knownDebt: true,
        reason: "temporary entry for the negative check",
      },
    ]);
    expect(writes).toEqual(["client -> auth"]);
    expect(explain(writes)).toContain("through the owner's .public.ts");
  });
});
