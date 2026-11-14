import { readFileSync } from "node:fs";
import type { Router } from "express";
import {
  collectRoutes,
  readMountPaths,
  type RouteInfo,
} from "./route-introspection.js";
import { buildOpenApiDocument, serializeDocument } from "./build-spec.js";
import type { JsonObject } from "./schema-walk.js";

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
): string => serializeDocument(createOpenApiDocument(apiRouter, clerkGuards));
