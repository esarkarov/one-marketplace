import { readFileSync } from "node:fs";
import type { Router } from "express";
import {
  collectRoutes,
  readMountPaths,
  type RouteInfo,
} from "./introspection/route-introspection.js";
import { buildOpenApiDocument } from "./builders/build-spec.js";
import { formatJson } from "./utils/json.utils.js";
import type { JsonObject } from "./types/openapi.types.js";

export const OPENAPI_FILE = new URL(
  "../../../../docs/api/openapi.json",
  import.meta.url,
);

const readVersion = (): string => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("services/api/package.json has no version.");
  }
  return manifest.version;
};

export const collectApiRoutes = (apiRouter: Router): RouteInfo[] =>
  collectRoutes(
    apiRouter,
    readMountPaths(
      readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8"),
    ),
  );

export const createOpenApiDocument = (
  apiRouter: Router,
  clerkGuards: readonly unknown[],
): JsonObject =>
  buildOpenApiDocument(collectApiRoutes(apiRouter), {
    version: readVersion(),
    clerkGuards,
  });

export const createOpenApiText = (
  apiRouter: Router,
  clerkGuards: readonly unknown[],
): string => formatJson(createOpenApiDocument(apiRouter, clerkGuards));
