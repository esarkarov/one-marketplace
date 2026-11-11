import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("health routes validation", () => {
  it.each(["/api/v1/health", "/api/v1/ready"])(
    "GET %s answers 400 for an unknown query key",
    async (path) => {
      const response = await request(app).get(path).query({ extra: "1" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    },
  );

  it("GET /health passes validation without a query", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
  });
});
