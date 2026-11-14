import { describe, expect, it } from "vitest";
import {
  moduleOf,
  operationIdOf,
  titleCase,
  toOpenApiPath,
} from "./openapi-naming.utils.js";

describe("openapi naming", () => {
  it("converts express params to OpenAPI templates", () => {
    expect(toOpenApiPath("/jobs/:id")).toMatch(/\/jobs\/\{id\}$/);
  });

  it("maps segments to modules", () => {
    expect(moduleOf("/conversations/:id")).toBe("messaging");
    expect(moduleOf("/health")).toBe("system");
    expect(moduleOf("/jobs")).toBe("jobs");
    expect(moduleOf("/")).toBe("root");
  });

  it("builds operation ids", () => {
    expect(operationIdOf("GET", "/jobs/:jobId/milestones")).toBe(
      "jobs_get_by_job_id_milestones",
    );
    expect(operationIdOf("GET", "/health")).toBe("system_get_health");
    expect(titleCase("jobs")).toBe("Jobs");
  });
});
