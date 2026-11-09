import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "./error.middleware.js";
import { validate } from "./validate.middleware.js";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/items/:id",
    validate({
      params: z.object({ id: z.guid({ error: "Item id is invalid." }) }),
      query: z.object({ page: z.string().optional() }),
      body: z.object({ name: z.string({ error: "Name must be text." }) }),
    }),
    (req, res) => {
      res.json({ params: req.params, query: req.query, body: req.body });
    },
  );
  app.post(
    "/plain",
    validate({ body: z.object({ name: z.string() }) }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.use(errorHandler);
  return app;
};

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("validate middleware", () => {
  it("replaces body, params and query with parsed values", async () => {
    const response = await request(buildApp())
      .post(`/items/${id}?page=2&extra=1`)
      .send({ name: "a", extra: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { id },
      query: { page: "2" },
      body: { name: "a" },
    });
  });

  it("answers 400 with the first custom issue message", async () => {
    const response = await request(buildApp())
      .post(`/items/${id}`)
      .send({ name: 5 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Name must be text.",
    });
  });

  it("validates params before the body", async () => {
    const response = await request(buildApp())
      .post("/items/not-a-uuid")
      .send({ name: 5 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Item id is invalid.");
  });

  it("uses a generic message and never echoes values", async () => {
    const response = await request(buildApp())
      .post("/plain")
      .send({ name: "secret-value-123".length });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid request.");
    expect(response.text).not.toContain("16");
  });

  it("rejects a missing body", async () => {
    const response = await request(buildApp()).post("/plain");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid request.");
  });
});
