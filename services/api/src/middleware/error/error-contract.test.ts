import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ApiError, defaultErrorCode } from "@/shared/errors/api-error.js";
import { errorHandler } from "./error.middleware.js";
import { jsonBody } from "@/middleware/json-body/json-body.middleware.js";
import { notFoundHandler } from "@/middleware/not-found/not-found.middleware.js";
import { requestIdMiddleware } from "@/middleware/request-id/request-id.middleware.js";
import { rateLimitBaseOptions } from "@/middleware/utils/rate-limit.utils.js";
import { validate } from "@/middleware/validate/validate.middleware.js";

const throwing = (error: Error) => () => {
  throw error;
};

const buildApp = () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(jsonBody);
  app.post(
    "/validated",
    validate({ body: z.strictObject({ name: z.string() }) }),
    (_request, response) => {
      response.json({ success: true });
    },
  );
  app.get("/401", throwing(new ApiError(401, "Authentication is required.")));
  app.get("/403", throwing(new ApiError(403, "Forbidden.")));
  app.get("/409", throwing(new ApiError(409, "Conflict.")));
  app.get("/423", throwing(new ApiError(423, "Locked.")));
  app.get("/503", throwing(new ApiError(503, "Not configured.")));
  app.get("/500", throwing(new Error("secret")));
  app.get("/explicit", throwing(new ApiError(409, "Locked.", "JOB_LOCKED")));
  app.get(
    "/limited",
    rateLimit({ ...rateLimitBaseOptions, limit: 1, windowMs: 60_000 }),
    (_request, response) => {
      response.json({ success: true });
    },
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

const expectCoded = (
  response: request.Response,
  status: number,
  code: string,
) => {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.code).toBe(code);
  expect(response.body.requestId).toEqual(expect.any(String));
  expect(response.body.requestId).toBe(response.headers["x-request-id"]);
};

describe("error responses carry code and requestId", () => {
  it("400 from validation", async () => {
    const response = await request(buildApp())
      .post("/validated")
      .send({ name: 1 });
    expectCoded(response, 400, "VALIDATION_ERROR");
    expect(response.body.errors).toEqual([
      { path: "body.name", message: expect.any(String) },
    ]);
  });

  it("400 from a malformed JSON body", async () => {
    const response = await request(buildApp())
      .post("/validated")
      .set("content-type", "application/json")
      .send("{not json");
    expectCoded(response, 400, "BAD_REQUEST");
  });

  it("401", async () => {
    expectCoded(await request(buildApp()).get("/401"), 401, "UNAUTHORIZED");
  });

  it("403", async () => {
    expectCoded(await request(buildApp()).get("/403"), 403, "FORBIDDEN");
  });

  it("404 from the not-found handler", async () => {
    expectCoded(await request(buildApp()).get("/nope"), 404, "NOT_FOUND");
  });

  it("409", async () => {
    expectCoded(await request(buildApp()).get("/409"), 409, "CONFLICT");
  });

  it("423", async () => {
    expectCoded(await request(buildApp()).get("/423"), 423, "LOCKED");
  });

  it("429 from the rate limiter", async () => {
    const app = buildApp();
    await request(app).get("/limited");
    const response = await request(app).get("/limited");
    expectCoded(response, 429, "RATE_LIMITED");
    expect(response.body.message).toBe(
      "Too many requests. Please try again later.",
    );
  });

  it("500 without leaking internals", async () => {
    const response = await request(buildApp()).get("/500");
    expectCoded(response, 500, "INTERNAL_ERROR");
    expect(response.text).not.toContain("secret");
  });

  it("503", async () => {
    expectCoded(
      await request(buildApp()).get("/503"),
      503,
      "SERVICE_UNAVAILABLE",
    );
  });

  it("keeps an explicit code instead of the status default", async () => {
    expectCoded(await request(buildApp()).get("/explicit"), 409, "JOB_LOCKED");
  });

  it("generates a request id when the handler runs without the middleware", async () => {
    const app = express();
    app.get("/early", throwing(new ApiError(404, "Missing.")));
    app.use(errorHandler);
    const response = await request(app).get("/early");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("generates a request id for 500 without the middleware", async () => {
    const app = express();
    app.get("/early", throwing(new Error("x")));
    app.use(errorHandler);
    const response = await request(app).get("/early");
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});

describe("defaultErrorCode", () => {
  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [423, "LOCKED"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ])("maps %i to %s", (status, code) => {
    expect(defaultErrorCode(status)).toBe(code);
    expect(new ApiError(status, "m").code).toBe(code);
  });

  it("keeps an explicit code", () => {
    expect(new ApiError(409, "m", "CONTRACT_EXISTS").code).toBe(
      "CONTRACT_EXISTS",
    );
  });
});
