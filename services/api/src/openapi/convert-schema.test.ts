import { describe, expect, it } from "vitest";
import { z } from "zod";
import { milestoneCheckoutBodySchema } from "../modules/contracts/contracts.schemas.js";
import { withIgnoredKeys } from "../shared/validation/common-schemas.js";
import { centsQueryParam } from "../shared/validation/money-schemas.js";
import { searchOffsetParam } from "../shared/validation/search-schemas.js";
import {
  convertSchema,
  IGNORED_PROPERTY_DESCRIPTION,
  registerComponent,
  type ComponentSchemas,
} from "./convert-schema.js";
import { findEmptySchemas, type JsonObject } from "./schema-walk.js";

const input = (schema: z.ZodType) => convertSchema(schema, "input", {});

describe("convertSchema fixtures", () => {
  it("emits the inner object for a preprocess optional body", () => {
    const schema = input(milestoneCheckoutBodySchema);

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object).sort()).toEqual([
      "requirements",
      "role",
    ]);
    expect(schema.required).toBeUndefined();
    expect(milestoneCheckoutBodySchema.safeParse(undefined).success).toBe(true);
  });

  it("lists withIgnoredKeys ignored keys as documented optional properties", () => {
    const schema = input(
      withIgnoredKeys({ name: z.string().min(1) }, ["id", "createdAt"]),
    );
    const properties = schema.properties as Record<string, JsonObject>;

    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["name"]);
    expect(properties.name).toEqual({ type: "string", minLength: 1 });
    for (const key of ["id", "createdAt"]) {
      expect(properties[key]).toEqual({
        description: IGNORED_PROPERTY_DESCRIPTION,
      });
    }
    expect(
      findEmptySchemas({ components: { schemas: { Fixture: schema } } }),
    ).toEqual([]);
  });

  it("documents a digit transform pipe as the integer it parses to", () => {
    const offset = input(z.strictObject({ offset: searchOffsetParam }));
    const cents = input(z.strictObject({ minCents: centsQueryParam }));
    const properties = offset.properties as Record<string, JsonObject>;
    const centsProperties = cents.properties as Record<string, JsonObject>;

    expect(properties.offset).toMatchObject({
      type: "integer",
      maximum: 10000,
    });
    expect(offset.required).toBeUndefined();
    expect(centsProperties.minCents).toMatchObject({
      type: "integer",
      minimum: 0,
    });
    expect(cents.required).toBeUndefined();
  });

  it("fails on two different definitions with one id", () => {
    const components: ComponentSchemas = {};
    registerComponent(components, "Shared", { type: "string" });

    expect(() =>
      registerComponent(components, "Shared", { type: "number" }),
    ).toThrow(/Shared/);
    expect(() =>
      registerComponent(components, "Shared", { type: "string" }),
    ).not.toThrow();
  });
});
