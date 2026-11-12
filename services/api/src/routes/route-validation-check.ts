import type { Router } from "express";
import type { z } from "zod";
import {
  getValidationSchemas,
  type ValidationSchemas,
} from "../shared/http/validate.middleware.js";
import { type ContractAllowlist } from "./contract-allowlist.js";
import type { ValidationAllowlistEntry } from "./validation-allowlist.js";

export interface RouteInfo {
  method: string;
  path: string;
  handlers: unknown[];
}

interface RouterLayer {
  handle: { stack?: RouterLayer[] };
  route?: {
    path: string;
    stack: { handle: unknown; method?: string }[];
    methods: Record<string, boolean>;
  };
  matchers: ((path: string) => unknown)[];
  slash?: boolean;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const PARTS = ["params", "query", "body"] as const;

interface SchemaDef {
  type: string;
  catchall?: { _zod: { def: SchemaDef } };
  in?: z.ZodType;
  out?: z.ZodType;
}

const defOf = (schema: z.ZodType): SchemaDef =>
  (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;

export const describeLooseSchema = (schema: z.ZodType): string | undefined => {
  const def = defOf(schema);
  switch (def.type) {
    case "pipe": {
      const input =
        def.in && defOf(def.in).type !== "transform" ? def.in : def.out;
      return input ? describeLooseSchema(input) : undefined;
    }
    case "object":
      return def.catchall?._zod.def.type === "never" ? undefined : "not strict";
    case "any":
    case "unknown":
    case "record":
      return def.type;
    default:
      return undefined;
  }
};

export const readMountPaths = (source: string): string[] =>
  [...source.matchAll(/\.use\(\s*"(\/[^"]*)"/g)].map((match) => match[1]!);

const joinPaths = (prefix: string, path: string) => {
  const joined = `${prefix}${path === "/" ? "" : path}`;
  return joined === "" ? "/" : joined;
};

export const collectRoutes = (
  router: Router,
  mountPaths: readonly string[],
  prefix = "",
): RouteInfo[] => {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const routes: RouteInfo[] = [];
  const inherited: unknown[] = [];

  for (const layer of stack) {
    if (layer.route) {
      const route = layer.route;
      for (const method of Object.keys(route.methods)) {
        routes.push({
          method: method.toUpperCase(),
          path: joinPaths(prefix, route.path),
          handlers: [
            ...inherited,
            ...route.stack
              .filter((item) => item.method === method)
              .map((item) => item.handle),
          ],
        });
      }
      continue;
    }

    if (!Array.isArray(layer.handle.stack)) {
      if (layer.slash) {
        inherited.push(layer.handle);
      }
      continue;
    }

    if (layer.slash) {
      throw new Error(
        "A nested router is mounted without a path; every router must be mounted at its own path.",
      );
    }

    const mount = mountPaths.find((candidate) =>
      layer.matchers.some((matcher) => matcher(candidate)),
    );
    if (mount === undefined) {
      throw new Error("Could not resolve the mount path of a nested router.");
    }
    routes.push(
      ...collectRoutes(layer.handle as unknown as Router, mountPaths, mount),
    );
  }

  return routes;
};

export const routeKey = (method: string, path: string) =>
  `${method.toUpperCase()} ${path}`;

export const schemasOf = (route: RouteInfo): ValidationSchemas | undefined => {
  for (const handler of route.handlers) {
    const schemas = getValidationSchemas(handler);
    if (schemas) return schemas;
  }
  return undefined;
};

export const findViolations = (
  routes: readonly RouteInfo[],
  allowlist: readonly ValidationAllowlistEntry[],
  bodyless: readonly ValidationAllowlistEntry[],
  publicRoutes: readonly ValidationAllowlistEntry[] = [],
): string[] => {
  const allowed = new Set(allowlist.map((e) => routeKey(e.method, e.path)));
  const noBody = new Set(bodyless.map((e) => routeKey(e.method, e.path)));
  const open = new Set(publicRoutes.map((e) => routeKey(e.method, e.path)));
  const violations: string[] = [];

  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    if (allowed.has(key)) continue;

    const schemas = schemasOf(route);
    if (!schemas) {
      violations.push(`${key}: no validate() handler`);
      continue;
    }

    const missing: string[] = [];
    if (route.path.includes(":") && !schemas.params) missing.push("params");
    if (!schemas.query) missing.push("query");
    if (BODY_METHODS.has(route.method) && !noBody.has(key) && !schemas.body) {
      missing.push("body");
    }
    if (missing.length > 0) {
      violations.push(`${key}: missing ${missing.join(", ")} schema`);
    }

    const index = route.handlers.findIndex((h) => getValidationSchemas(h));
    if (index === route.handlers.length - 1) {
      violations.push(`${key}: validate() must run before the last handler`);
    } else if (index === 0 && !open.has(key)) {
      violations.push(`${key}: validate() runs before any auth middleware`);
    }

    for (const part of PARTS) {
      const schema = schemas[part];
      const loose = schema ? describeLooseSchema(schema) : undefined;
      if (loose) violations.push(`${key}: ${part} schema is ${loose}`);
    }
  }

  return violations;
};

const declaresSuccess = (route: RouteInfo) => {
  const responses = schemasOf(route)?.responses;
  return (
    responses !== undefined &&
    Object.entries(responses).some(
      ([status, schema]) =>
        schema !== undefined && Number(status) >= 200 && Number(status) < 300,
    )
  );
};

export const findContractViolations = (
  routes: readonly RouteInfo[],
  allowlist: ContractAllowlist,
): string[] => {
  const exempt = new Set(
    [...allowlist.rawBodyWebhooks, ...allowlist.eventStreams].map((e) =>
      routeKey(e.method, e.path),
    ),
  );
  const violations: string[] = [];

  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    if (exempt.has(key)) continue;
    if (!declaresSuccess(route)) {
      violations.push(`${key}: missing responses with a 2xx schema`);
    }
  }

  return violations;
};

export const findContractAllowlistProblems = (
  routes: readonly RouteInfo[],
  allowlist: ContractAllowlist,
): string[] => {
  const byKey = new Map(
    routes.map((r) => [routeKey(r.method, r.path), r] as const),
  );
  const problems: string[] = [];
  const groups = [
    ["rawBodyWebhooks", allowlist.rawBodyWebhooks, true],
    ["eventStreams", allowlist.eventStreams, true],
    ["untestedRoutes", allowlist.untestedRoutes, false],
  ] as const;

  for (const [name, entries, rejectDeclared] of groups) {
    for (const entry of entries) {
      const key = routeKey(entry.method, entry.path);
      const route = byKey.get(key);
      if (!route) {
        problems.push(`${name}: ${key} does not exist`);
        continue;
      }
      if (entry.reason.trim() === "") {
        problems.push(`${name}: ${key} has no reason`);
      }
      if (rejectDeclared && declaresSuccess(route)) {
        problems.push(`${name}: ${key} declares responses, remove the entry`);
      }
    }
  }

  return problems;
};

export const findStaleEntries = (
  routes: readonly RouteInfo[],
  entries: readonly ValidationAllowlistEntry[],
): string[] => {
  const known = new Set(routes.map((r) => routeKey(r.method, r.path)));
  return entries
    .map((e) => routeKey(e.method, e.path))
    .filter((key) => !known.has(key));
};
