import { Router } from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware.js";
import type { ContractAllowlist } from "./contract-allowlist.js";
import {
  collectRoutes,
  findContractAllowlistProblems,
  findContractViolations,
} from "./route-validation-check.js";

const noop = () => undefined;
const auth = () => undefined;
const ok = { 200: z.strictObject({ success: z.boolean() }) };

const empty: ContractAllowlist = {
  rawBodyWebhooks: [],
  eventStreams: [],
  untestedRoutes: [],
};

const build = (fn: (router: Router) => void) => {
  const router = Router();
  fn(router);
  return collectRoutes(router, []);
};

describe("contract check", () => {
  it("accepts routes that declare a 2xx response, with or without request schemas", () => {
    const routes = build((r) => {
      r.get("/a", auth, validate({ query: {}, responses: ok }), noop);
      r.get("/b", auth, validate({ responses: ok }), noop);
    });

    expect(findContractViolations(routes, empty)).toEqual([]);
  });

  it("reports routes without responses or without a 2xx entry", () => {
    const routes = build((r) => {
      r.get("/a", auth, validate({ query: {} }), noop);
      r.get("/b", auth, validate({ query: {}, responses: {} }), noop);
      r.get(
        "/c",
        auth,
        validate({ query: {}, responses: { 404: z.strictObject({}) } }),
        noop,
      );
      r.get("/d", noop);
    });

    expect(findContractViolations(routes, empty)).toEqual([
      "GET /a: missing responses with a 2xx schema",
      "GET /b: missing responses with a 2xx schema",
      "GET /c: missing responses with a 2xx schema",
      "GET /d: missing responses with a 2xx schema",
    ]);
  });

  it("accepts allowlisted raw-body, stream and untested routes", () => {
    const routes = build((r) => {
      r.post("/hook", noop);
      r.get("/stream", auth, validate({ query: {} }), noop);
      r.get("/hard", auth, validate({ query: {}, responses: ok }), noop);
    });
    const allowlist: ContractAllowlist = {
      rawBodyWebhooks: [{ method: "POST", path: "/hook", reason: "raw" }],
      eventStreams: [{ method: "GET", path: "/stream", reason: "sse" }],
      untestedRoutes: [{ method: "GET", path: "/hard", reason: "needs fake" }],
    };

    expect(findContractViolations(routes, allowlist)).toEqual([]);
    expect(findContractAllowlistProblems(routes, allowlist)).toEqual([]);
  });

  it("requires untested routes to still declare a 2xx response", () => {
    const routes = build((r) => {
      r.get("/hard", auth, validate({ query: {} }), noop);
    });
    const allowlist: ContractAllowlist = {
      ...empty,
      untestedRoutes: [{ method: "GET", path: "/hard", reason: "needs fake" }],
    };

    expect(findContractViolations(routes, allowlist)).toEqual([
      "GET /hard: missing responses with a 2xx schema",
    ]);
  });

  it("fails on stale entries", () => {
    const routes = build((r) => {
      r.get("/stream", auth, validate({ query: {}, responses: ok }), noop);
    });
    const allowlist: ContractAllowlist = {
      rawBodyWebhooks: [{ method: "POST", path: "/gone", reason: "raw" }],
      eventStreams: [{ method: "GET", path: "/stream", reason: "sse" }],
      untestedRoutes: [{ method: "GET", path: "/missing", reason: "x" }],
    };

    expect(findContractAllowlistProblems(routes, allowlist)).toEqual([
      "rawBodyWebhooks: POST /gone does not exist",
      "eventStreams: GET /stream declares responses, remove the entry",
      "untestedRoutes: GET /missing does not exist",
    ]);
  });

  it("requires a reason on every entry", () => {
    const routes = build((r) => {
      r.get("/hard", auth, validate({ query: {} }), noop);
    });
    const allowlist: ContractAllowlist = {
      ...empty,
      untestedRoutes: [{ method: "GET", path: "/hard", reason: "  " }],
    };

    expect(findContractAllowlistProblems(routes, allowlist)).toEqual([
      "untestedRoutes: GET /hard has no reason",
    ]);
  });
});
