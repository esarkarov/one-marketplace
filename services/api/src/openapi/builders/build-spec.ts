import {
  ErrorBody,
  InternalErrorBody,
  RateLimitBody,
  ValidationErrorBody,
} from "../../shared/responses/api-envelope.responses.js";
import {
  buildBody,
  buildParameters,
  buildResponse,
  buildWebhookOperation,
  securityOf,
} from "./build-operation.js";
import { contractAllowlist } from "../introspection/contract-allowlist.js";
import { sortKeys } from "../utils/json.utils.js";
import {
  ADMIN_SESSION,
  CLERK_BEARER,
  DEFAULT_PORT,
} from "../constants/openapi.constants.js";
import {
  moduleOf,
  operationIdOf,
  titleCase,
  toOpenApiPath,
} from "../utils/openapi-naming.utils.js";
import type { ComponentSchemas, JsonObject } from "../types/openapi.types.js";
import { findEmptySchemas } from "../utils/schema-traversal.utils.js";
import {
  routeKey,
  schemasOf,
  type RouteInfo,
} from "../introspection/route-introspection.js";

interface BuildSpecOptions {
  version: string;
  clerkGuards: readonly unknown[];
}

export const buildOpenApiDocument = (
  routes: readonly RouteInfo[],
  options: BuildSpecOptions,
): JsonObject => {
  const clerkGuards: ReadonlySet<unknown> = new Set(options.clerkGuards);
  const components: ComponentSchemas = {};
  const paths: JsonObject = {};
  const tags = new Set<string>();
  const operationIds = new Map<string, string>();

  const webhooks = new Set(
    contractAllowlist.rawBodyWebhooks.map((e) => routeKey(e.method, e.path)),
  );
  const streams = new Set(
    contractAllowlist.eventStreams.map((e) => routeKey(e.method, e.path)),
  );

  const validation = buildResponse("400", ValidationErrorBody, components);
  const unauthorized = buildResponse("401", ErrorBody, components);
  const rateLimited = buildResponse("429", RateLimitBody, components);
  const internal = buildResponse("500", InternalErrorBody, components);
  const badSignature = buildResponse("400", ErrorBody, components);

  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    const schemas = schemasOf(route);
    const method = route.method.toLowerCase();
    const path = toOpenApiPath(route.path);
    const module = moduleOf(route.path);
    const operationId = operationIdOf(route.method, route.path);
    const tag = titleCase(module);
    const isWebhook = webhooks.has(key);
    const isStream = streams.has(key);

    const clash = operationIds.get(operationId);
    if (clash) {
      throw new Error(
        `operationId "${operationId}" is used by ${clash} and ${key}.`,
      );
    }
    operationIds.set(operationId, key);
    tags.add(tag);

    const security = isWebhook ? [] : securityOf(route, clerkGuards);
    const operation: JsonObject = { operationId, tags: [tag], security };
    const responses: JsonObject = {};

    if (isWebhook) {
      const webhook = buildWebhookOperation(route.path, badSignature);
      Object.assign(operation, webhook.fields);
      Object.assign(responses, webhook.responses);
    } else {
      if (!schemas) throw new Error(`${key}: no validate() handler.`);

      const parameters = buildParameters(
        route,
        schemas,
        components,
        security.some((item) => CLERK_BEARER in item),
      );
      if (parameters.length > 0) operation.parameters = parameters;
      if (schemas.body) {
        operation.requestBody = buildBody(schemas.body, components);
      }

      for (const [status, schema] of Object.entries(schemas.responses ?? {})) {
        if (schema)
          responses[status] = buildResponse(status, schema, components);
      }

      if (isStream) {
        responses["200"] = {
          description: "Server-sent event stream.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        };
        if (security.some((item) => ADMIN_SESSION in item)) {
          operation.description =
            "Authenticate with the admin session token as a bearer token or in the token query parameter.";
        }
      }

      if (schemas.params || schemas.query || schemas.body) {
        responses["400"] ??= validation;
      }
      if (security.length > 0) responses["401"] ??= unauthorized;
    }

    responses["429"] ??= rateLimited;
    responses["500"] ??= internal;
    operation.responses = responses;

    const item = (paths[path] ??= {}) as JsonObject;
    if (item[method]) throw new Error(`Duplicate operation ${key}.`);
    item[method] = operation;
  }

  const securitySchemes: JsonObject = {
    [CLERK_BEARER]: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Clerk session token sent as a bearer token.",
    },
    [ADMIN_SESSION]: {
      type: "http",
      scheme: "bearer",
      description:
        "Admin session bearer token: `<expiresAtMs>.<hmac-sha256-hex>` signed with the server's admin session secret.",
    },
  };

  const document: JsonObject = {
    openapi: "3.1.0",
    info: {
      title: "OneMarketplace API",
      description:
        "HTTP API of the OneMarketplace freelancing marketplace. Money fields are integer cents.",
      version: options.version,
    },
    servers: [{ url: `http://localhost:${DEFAULT_PORT}` }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: { schemas: components, securitySchemes },
  };

  const empty = findEmptySchemas(document);
  if (empty.length > 0) {
    throw new Error(`Empty schemas in the document:\n${empty.join("\n")}`);
  }

  return sortKeys(document) as JsonObject;
};
