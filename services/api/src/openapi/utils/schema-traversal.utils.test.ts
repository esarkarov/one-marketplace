import { describe, expect, it } from "vitest";
import type { JsonObject } from "../types/openapi.types.js";
import {
  findEmptySchemas,
  walkDocumentSchemas,
  walkSchema,
} from "./schema-traversal.utils.js";

describe("walkSchema", () => {
  it("visits nested keywords with their paths and property names", () => {
    const seen: string[] = [];
    walkSchema(
      {
        properties: { a: { items: { type: "string" } } },
        anyOf: [{ type: "null" }],
      },
      "#",
      (_schema, path, name) => seen.push(`${path}|${name ?? ""}`),
    );

    expect(seen).toEqual([
      "#|",
      "#/anyOf/0|",
      "#/properties/a|a",
      "#/properties/a/items|",
    ]);
  });
});

describe("findEmptySchemas", () => {
  it("reports empty schemas in components, parameters, requests and responses", () => {
    const empty = { schema: {} };
    const document: JsonObject = {
      components: { schemas: { Any: {}, Ok: { type: "string" } } },
      paths: {
        "/x": {
          get: {
            parameters: [{ name: "q", in: "query", schema: {} }],
            requestBody: { content: { "application/json": empty } },
            responses: { "200": { content: { "application/json": empty } } },
          },
        },
      },
    };

    expect(findEmptySchemas(document)).toEqual([
      "#/components/schemas/Any",
      "#/paths//x/get/parameters/0/schema",
      "#/paths//x/get/requestBody/application/json/schema",
      "#/paths//x/get/responses/200/application/json/schema",
    ]);
  });

  it("returns nothing for a document without empty schemas", () => {
    expect(findEmptySchemas({ paths: {} })).toEqual([]);
  });
});

describe("walkDocumentSchemas", () => {
  it("names a parameter schema root after the parameter", () => {
    const seen: (string | undefined)[] = [];
    walkDocumentSchemas(
      {
        paths: {
          "/x": {
            get: { parameters: [{ name: "id", schema: { type: "string" } }] },
          },
        },
      },
      (_schema, _path, name, kind) => {
        if (kind === "parameter") seen.push(name);
      },
    );

    expect(seen).toEqual(["id"]);
  });
});
