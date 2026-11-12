import { describe, expect, it } from "vitest";
import { discoverTableDefinitions, moduleNames } from "./table-access.js";
import { tableOwners } from "./table-ownership.js";

const definitions = discoverTableDefinitions();

describe("table ownership", () => {
  it("finds the tables and enums to own", () => {
    expect(definitions.length).toBeGreaterThan(0);
  });

  it("gives every exported table and enum an owner", () => {
    const unowned = definitions
      .filter((definition) => !tableOwners[definition.name])
      .map((definition) => `${definition.name} (${definition.file})`);
    expect(unowned).toEqual([]);
  });

  it("names only tables and enums that exist", () => {
    const defined = new Set(definitions.map((definition) => definition.name));
    expect(
      Object.keys(tableOwners).filter((name) => !defined.has(name)),
    ).toEqual([]);
  });

  it("names only modules that exist", () => {
    const modules = new Set(moduleNames());
    expect(
      Object.entries(tableOwners)
        .filter(([, owner]) => !modules.has(owner))
        .map(([name, owner]) => `${name} -> ${owner}`),
    ).toEqual([]);
  });

  it("defines each table and enum once", () => {
    const names = definitions.map((definition) => definition.name);
    expect(
      names.filter((name, index) => names.indexOf(name) !== index),
    ).toEqual([]);
  });
});
