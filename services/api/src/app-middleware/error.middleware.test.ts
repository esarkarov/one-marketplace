import express from "express";
import type { Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAppLogger, createRootLogger, logger } from "../config/logger.js";
import { captureLogs } from "../test/support/capture-logs.js";
import { fakeStripeKey } from "../test/support/fake-secrets.js";
import { ApiError } from "../shared/http/api-error.js";
import { errorHandler } from "./error.middleware.js";
import { requestIdMiddleware } from "./request-id.middleware.js";

const app = express();
app.use(requestIdMiddleware);
app.use((req, _res, next) => {
  req.logger = logger;
  next();
});
app.get("/boom", () => {
  throw new Error("secret internal detail");
});
app.get("/bad", () => {
  throw new ApiError(400, "visible message");
});
app.get("/coded", () => {
  throw new ApiError(400, "bad field", "VALIDATION_ERROR", [
    { path: "body.title", message: "bad field" },
  ]);
});
app.get("/stripe", () => {
  throw Object.assign(
    new Error(`No such customer: cus_123 ${fakeStripeKey("test", "abc")}`),
    { statusCode: 402 },
  );
});
app.get("/exposed", () => {
  throw Object.assign(new Error("invalid json"), {
    status: 400,
    expose: true,
  });
});
app.use(errorHandler);

const noLoggerApp = express();
noLoggerApp.use(requestIdMiddleware);
noLoggerApp.get("/boom", () => {
  throw new Error("secret internal detail");
});
noLoggerApp.use(errorHandler);

describe("error handler", () => {
  it("treats third-party errors with a 4xx status as 500", async () => {
    const response = await request(app).get("/stripe");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
    expect(response.text).not.toContain("cus_123");
    expect(response.text).not.toContain(fakeStripeKey("test", "abc"));
  });

  it("keeps the message and status when expose is true", async () => {
    const response = await request(app).get("/exposed");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("invalid json");
  });

  it("does not throw when request.logger is undefined", async () => {
    const response = await request(noLoggerApp).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
  });

  it("delegates to next when headers were already sent", () => {
    const failure = new Error("late failure");
    const next = vi.fn();
    const response = { headersSent: true, status: vi.fn() };

    errorHandler(failure, {} as Request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("hides internal details on 500", async () => {
    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.text).not.toContain("secret internal detail");
  });

  it("emits code and errors from an ApiError on 4xx", async () => {
    const response = await request(app).get("/coded");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "bad field",
      code: "VALIDATION_ERROR",
      errors: [{ path: "body.title", message: "bad field" }],
    });
  });

  it("keeps the message on 4xx", async () => {
    const response = await request(app).get("/bad");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("visible message");
  });
});

describe("request id", () => {
  it("echoes a valid client id", async () => {
    const response = await request(app)
      .get("/bad")
      .set("x-request-id", "abc-123_X.y");

    expect(response.headers["x-request-id"]).toBe("abc-123_X.y");
  });

  it.each(["has spaces", "a".repeat(65), "<script>"])(
    "replaces the invalid id %s",
    async (value) => {
      const response = await request(app)
        .get("/bad")
        .set("x-request-id", value);

      expect(response.headers["x-request-id"]).not.toBe(value);
      expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});

describe("error handler logging", () => {
  it("logs without secrets or raw third-party objects", async () => {
    const { stream, output } = captureLogs();
    const base = createRootLogger(stream, "info");
    const logApp = express();
    logApp.use(requestIdMiddleware);
    logApp.use((req, _res, next) => {
      req.logger = createAppLogger(base);
      next();
    });
    logApp.get("/third-party", () => {
      throw Object.assign(
        new Error(`failed with key ${fakeStripeKey("live", "topsecret99")}`),
        { raw: { nested: "raw-payload-marker", card: "4242" } },
      );
    });
    logApp.use(errorHandler);

    const response = await request(logApp).get("/third-party");

    expect(response.status).toBe(500);
    expect(output()).toContain("system.request.failed");
    expect(output()).not.toContain("topsecret99");
    expect(output()).not.toContain("raw-payload-marker");
  });

  it("logs database errors without SQL, params or message text", async () => {
    const { stream, output, lines } = captureLogs();
    const base = createRootLogger(stream, "info");
    const logApp = express();
    logApp.use(requestIdMiddleware);
    logApp.use((req, _res, next) => {
      req.logger = createAppLogger(base);
      next();
    });
    logApp.get("/db", () => {
      throw Object.assign(
        new Error(
          "Failed query: select * from accounts where email = $1\nparams: alice@example.test,42",
        ),
        { cause: { code: "23505" } },
      );
    });
    logApp.use(errorHandler);

    const response = await request(logApp).get("/db");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Internal server error.");
    expect(output()).toContain("system.request.failed");
    expect(output()).not.toContain("select * from");
    expect(output()).not.toContain("params:");
    expect(output()).not.toContain("alice@example.test");
    const entry = JSON.parse(lines()[0]!);
    expect(entry.attributes["error.message"]).toBe("Database query failed");
    expect(entry.attributes["error.code"]).toBe("23505");
  });
});
