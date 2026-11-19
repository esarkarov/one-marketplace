import express from "express";
import type { Request } from "express";
import request from "supertest";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "@/middleware/error/error.middleware.js";
import type { RequestSchemas } from "@/middleware/types/validate.types.js";
import { validate } from "@/middleware/validate/validate.middleware.js";
import { getValidated } from "./validated-request.utils.js";

const params = z.strictObject({ id: z.guid() });
const query = z.strictObject({
  limit: z.coerce.number().int().default(20),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});
const body = z.strictObject({
  title: z.string().trim(),
  note: z.string().optional(),
});
const shapeQuery = { page: z.coerce.number().int().optional() };

const fullRequest = { params, query, body } satisfies RequestSchemas;
const queryOnlyRequest = { query } satisfies RequestSchemas;
const shapeRequest = { query: shapeQuery } satisfies RequestSchemas;

const ID = "0f3c6b52-6f0e-4a54-8f4e-7a4b5b4a0c11";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/items/:id", validate(fullRequest), (req, res) => {
    res.json(getValidated(req, fullRequest));
  });
  app.get("/items", validate(queryOnlyRequest), (req, res) => {
    res.json(getValidated(req, queryOnlyRequest));
  });
  app.get("/shape", validate(shapeRequest), (req, res) => {
    res.json(getValidated(req, shapeRequest));
  });
  app.get("/unvalidated", (req, res) => {
    res.json(getValidated(req, queryOnlyRequest));
  });
  app.post("/partial", validate(queryOnlyRequest), (req, res) => {
    res.json(getValidated(req, fullRequest));
  });
  app.use(errorHandler);
  return app;
};

describe("getValidated", () => {
  it("returns the parsed body, params and query", async () => {
    const response = await request(buildApp())
      .post(`/items/${ID}?limit=5&sort=oldest`)
      .send({ title: "  hello  " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { id: ID },
      query: { limit: 5, sort: "oldest" },
      body: { title: "hello" },
    });
  });

  it("passes coerced numbers and defaults through as parsed values", async () => {
    const response = await request(buildApp()).get("/items");

    expect(response.body).toEqual({ query: { limit: 20, sort: "newest" } });
  });

  it("returns only the keys the schemas object supplies", async () => {
    const response = await request(buildApp()).get("/items?limit=3");

    expect(Object.keys(response.body)).toEqual(["query"]);
  });

  it("accepts a raw shape as a schema", async () => {
    const response = await request(buildApp()).get("/shape?page=2");

    expect(response.body).toEqual({ query: { page: 2 } });
  });

  it("throws a 500 programming error when validate did not run", async () => {
    const response = await request(buildApp()).get("/unvalidated");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(response.body.message).toBe("Internal server error.");
  });

  it("throws when validate ran without one of the requested keys", async () => {
    const response = await request(buildApp()).post(`/partial`).send({});

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
  });

  it("reads the recorded parse result, not the request fields", () => {
    const fake = {
      method: "GET",
      path: "/x",
      query: { limit: "5" },
      validated: { query: { limit: 5, sort: "newest" } },
    } as unknown as Request;

    expect(getValidated(fake, queryOnlyRequest)).toEqual({
      query: { limit: 5, sort: "newest" },
    });
  });

  it("names the missing part and route in the thrown error", () => {
    const fake = {
      method: "GET",
      path: "/x",
      validated: { query: {} },
    } as unknown as Request;

    expect(() => getValidated(fake, fullRequest)).toThrow(
      "validate() did not run for request params on GET /x.",
    );
  });
});

describe("getValidated types", () => {
  type Full = ReturnType<typeof getValidated<typeof fullRequest>>;
  type QueryOnly = ReturnType<typeof getValidated<typeof queryOnlyRequest>>;
  type Shape = ReturnType<typeof getValidated<typeof shapeRequest>>;

  it("infers each supplied key from its schema output", () => {
    expectTypeOf<Full>().toEqualTypeOf<{
      params: { id: string };
      query: { limit: number; sort: "newest" | "oldest" };
      body: { title: string; note?: string | undefined };
    }>();
    expectTypeOf<QueryOnly>().toEqualTypeOf<{
      query: { limit: number; sort: "newest" | "oldest" };
    }>();
    expectTypeOf<Shape>().toEqualTypeOf<{
      query: { page?: number | undefined };
    }>();
  });

  it("omits keys that were not supplied", () => {
    expectTypeOf<QueryOnly>().not.toHaveProperty("body");
    expectTypeOf<QueryOnly>().not.toHaveProperty("params");
  });
});
