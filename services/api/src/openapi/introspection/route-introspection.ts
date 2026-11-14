import type { Router } from "express";
import {
  getValidationSchemas,
  type ValidationSchemas,
} from "../../shared/http/validate.middleware.js";

export interface ValidationAllowlistEntry {
  method: string;
  path: string;
  reason: string;
}

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
