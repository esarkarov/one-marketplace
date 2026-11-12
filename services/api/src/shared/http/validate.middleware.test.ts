import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidParams, withIgnoredKeys } from "../validation/common-schemas.js";
import { errorHandler } from "./error.middleware.js";
import {
  VALIDATION_SCHEMAS,
  getValidationSchemas,
  validate,
} from "./validate.middleware.js";

const itemsValidator = validate({
  params: { id: z.guid({ error: "Item id is invalid." }) },
  query: { page: z.coerce.number().int().optional() },
  body: { name: z.string({ error: "Name must be text." }) },
});

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/items/:id", itemsValidator, (req, res) => {
    res.json({ params: req.params, query: req.query, body: req.body });
  });
  app.post("/plain", validate({ body: { name: z.string() } }), (_req, res) => {
    res.json({ ok: true });
  });
  app.put(
    "/profile",
    validate({
      body: withIgnoredKeys({ title: z.string() }, ["id", "createdAt"]),
    }),
    (req, res) => {
      res.json({ body: req.body });
    },
  );
  app.get(
    "/jobs/:jobId/proposals/:proposalId",
    validate({ params: uuidParams("jobId", "proposalId") }),
    (req, res) => {
      res.json({ params: req.params });
    },
  );
  app.use(errorHandler);
  return app;
};

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("validate middleware", () => {
  it("replaces params and query with coerced values and the body with parsed values", async () => {
    const response = await request(buildApp())
      .post(`/items/${id}?page=2`)
      .send({ name: "a" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { id },
      query: { page: 2 },
      body: { name: "a" },
    });
  });

  it("rejects unknown body and query keys with their path", async () => {
    const body = await request(buildApp())
      .post(`/items/${id}`)
      .send({ name: "a", extra: true });
    const query = await request(buildApp())
      .post(`/items/${id}?bogus=1`)
      .send({ name: "a" });

    expect(body.status).toBe(400);
    expect(body.body).toEqual({
      success: false,
      message: "Unknown field.",
      code: "VALIDATION_ERROR",
      errors: [{ path: "body.extra", message: "Unknown field." }],
    });
    expect(query.body.errors).toEqual([
      { path: "query.bogus", message: "Unknown field." },
    ]);
  });

  it("answers 400 with the first custom issue message and part-prefixed paths", async () => {
    const response = await request(buildApp())
      .post(`/items/${id}`)
      .send({ name: 5 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Name must be text.",
      code: "VALIDATION_ERROR",
      errors: [{ path: "body.name", message: "Name must be text." }],
    });
  });

  it("reports params errors first", async () => {
    const response = await request(buildApp())
      .post("/items/not-a-uuid")
      .send({ name: 5 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Item id is invalid.");
    expect(response.body.errors[0].path).toBe("params.id");
  });

  it("never echoes received values", async () => {
    const response = await request(buildApp())
      .post("/plain")
      .send({ name: 987654321 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid type.");
    expect(response.text).not.toContain("987654321");

    const leaky = await request(buildApp())
      .post("/plain")
      .send({ name: "ok", "secret-key-xyz": "secret-value-xyz" });

    expect(leaky.text).not.toContain("secret-value-xyz");
  });

  it("rejects a missing body", async () => {
    const response = await request(buildApp()).post("/plain");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.errors[0].path).toBe("body");
  });

  it("fails coercion in query params", async () => {
    const response = await request(buildApp())
      .post(`/items/${id}?page=abc`)
      .send({ name: "a" });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe("query.page");
  });

  it("attaches the schemas to the handler", () => {
    const schemas = getValidationSchemas(itemsValidator);

    expect(schemas?.params).toBeInstanceOf(z.ZodType);
    expect(schemas?.query).toBeInstanceOf(z.ZodType);
    expect(schemas?.body).toBeInstanceOf(z.ZodType);
    expect(
      (itemsValidator as unknown as Record<symbol, unknown>)[
        VALIDATION_SCHEMAS
      ],
    ).toBe(schemas);
    expect(getValidationSchemas(validate({}))).toEqual({});
    expect(getValidationSchemas(() => {})).toBeUndefined();
  });

  it("accepts zod objects as given", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/loose",
      validate({ body: z.looseObject({ a: z.string() }) }),
      (req, res) => {
        res.json(req.body);
      },
    );

    const response = await request(app).post("/loose").send({ a: "x", b: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ a: "x", b: 1 });
  });
});

describe("withIgnoredKeys", () => {
  it("drops ignored keys and keeps the rest", async () => {
    const response = await request(buildApp())
      .put("/profile")
      .send({ title: "t", id: "x", createdAt: "y" });

    expect(response.status).toBe(200);
    expect(response.body.body).toEqual({ title: "t" });
  });

  it("still rejects other unknown keys", async () => {
    const response = await request(buildApp())
      .put("/profile")
      .send({ title: "t", id: "x", role: "admin" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      { path: "body.role", message: "Unknown field." },
    ]);
  });
});

describe("uuidParams", () => {
  it("accepts uuids", async () => {
    const response = await request(buildApp()).get(
      `/jobs/${id}/proposals/${id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.params).toEqual({ jobId: id, proposalId: id });
  });

  it("rejects non-uuid params with the param path", async () => {
    const response = await request(buildApp()).get(
      `/jobs/${id}/proposals/nope`,
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("proposalId is invalid.");
    expect(response.body.errors[0].path).toBe("params.proposalId");
  });
});

describe("validate error reporting", () => {
  it("caps reported errors at 50 and truncates unknown key names", async () => {
    const app = express();
    app.use(express.json());
    app.post("/x", validate({ body: { name: z.string() } }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    const body: Record<string, number> = {};
    for (let i = 0; i < 80; i += 1) body[`${"k".repeat(200)}${i}`] = i;

    const response = await request(app).post("/x").send(body);

    expect(response.status).toBe(400);
    expect(response.body.errors).toHaveLength(50);
    for (const error of response.body.errors) {
      expect(error.path.length).toBeLessThanOrEqual("body.".length + 64);
    }
  });

  it("uses the schema message for a failed union", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/x",
      validate({
        body: {
          id: z
            .union([z.number(), z.boolean()], { error: "Job post is invalid." })
            .nullish(),
        },
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(errorHandler);

    const response = await request(app).post("/x").send({ id: "nope" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Job post is invalid.");
    expect(response.body.errors[0].path).toBe("body.id");
  });
});
