import { STATUS_CODES } from "node:http";
import type { z } from "zod";
import { API_PREFIX } from "../config/constants.js";
import {
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "../shared/http/auth/auth.middleware.js";
import {
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
} from "../shared/http/auth/admin-session.middleware.js";
import { contractAllowlist } from "../routes/contract-allowlist.js";
import {
  routeKey,
  schemasOf,
  type RouteInfo,
} from "../routes/route-validation-check.js";
import {
  ErrorBody,
  InternalErrorBody,
  RateLimitBody,
  ValidationErrorBody,
} from "../shared/validation/response-schemas.js";
import { convertSchema, type ComponentSchemas } from "./convert-schema.js";
import {
  findEmptySchemas,
  formatJson,
  isObject,
  sortKeys,
  type Json,
  type JsonObject,
} from "./schema-walk.js";

export const DEFAULT_PORT = 4000;

const CLERK_BEARER = "clerkBearer";
const ADMIN_SESSION = "adminSession";

const CLERK_GUARDS: ReadonlySet<unknown> = new Set([
  isAuthenticated,
  identifyAccount,
  verifyBearerToken,
]);
const ADMIN_GUARDS: ReadonlySet<unknown> = new Set([
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
]);

export const CONTROLLER_AUTH_OVERRIDES: Readonly<
  Record<string, { scheme: typeof CLERK_BEARER; reason: string }>
> = {
  "POST /auth/sign-up": {
    scheme: CLERK_BEARER,
    reason:
      "The controller reads the bearer token and calls authenticateAccount, which answers 401 without a valid Clerk token.",
  },
};

const MODULE_BY_SEGMENT: Readonly<Record<string, string>> = {
  conversations: "messaging",
  health: "system",
  ready: "system",
};
const UNMOUNTED_SEGMENTS: ReadonlySet<string> = new Set(["health", "ready"]);

const SIGNATURE_HEADERS: Readonly<Record<string, readonly string[]>> = {
  stripe: ["stripe-signature"],
  daily: ["x-webhook-signature", "x-webhook-timestamp"],
};

export interface BuildSpecOptions {
  version: string;
}

const snake = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const toOpenApiPath = (path: string) =>
  `${API_PREFIX}${path}`.replace(/:(\w+)/g, "{$1}");

export const moduleOf = (path: string): string => {
  const segment = path.split("/").find((part) => part !== "") ?? "root";
  return MODULE_BY_SEGMENT[segment] ?? snake(segment);
};

export const operationIdOf = (method: string, path: string): string => {
  const segments = path.split("/").filter((part) => part !== "");
  const first = segments[0] ?? "root";
  const rest = UNMOUNTED_SEGMENTS.has(first) ? segments : segments.slice(1);
  const words = rest.map((segment) =>
    segment.startsWith(":") ? `by_${snake(segment.slice(1))}` : snake(segment),
  );
  return [moduleOf(path), method.toLowerCase(), ...words].join("_");
};

const securityOf = (route: RouteInfo) => {
  const clerk = route.handlers.some((handler) => CLERK_GUARDS.has(handler));
  const admin = route.handlers.some((handler) => ADMIN_GUARDS.has(handler));
  if (clerk && admin) {
    throw new Error(
      `${routeKey(route.method, route.path)} runs both Clerk and admin guards.`,
    );
  }
  if (clerk) return [{ [CLERK_BEARER]: [] }];
  if (admin) return [{ [ADMIN_SESSION]: [] }];
  const override =
    CONTROLLER_AUTH_OVERRIDES[routeKey(route.method, route.path)];
  if (override) return [{ [override.scheme]: [] }];
  return [];
};

const resolveObject = (
  schema: JsonObject,
  components: ComponentSchemas,
): JsonObject => {
  const ref = schema.$ref;
  if (typeof ref === "string") {
    const target = components[ref.slice("#/components/schemas/".length)];
    if (!target) throw new Error(`Unresolved reference ${ref}.`);
    return target;
  }
  return schema;
};

const objectParts = (
  schema: z.ZodType,
  components: ComponentSchemas,
  where: string,
) => {
  const converted = resolveObject(
    convertSchema(schema, "input", components),
    components,
  );
  if (converted.type !== "object" || !isObject(converted.properties)) {
    throw new Error(`${where} must be an object schema.`);
  }
  const required = Array.isArray(converted.required)
    ? (converted.required as string[])
    : [];
  return { properties: converted.properties, required };
};

const buildParameters = (
  route: RouteInfo,
  schemas: NonNullable<ReturnType<typeof schemasOf>>,
  components: ComponentSchemas,
  clerkSecured: boolean,
): JsonObject[] => {
  const key = routeKey(route.method, route.path);
  const parameters: JsonObject[] = [];
  const templateNames = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);

  if (schemas.params) {
    const { properties } = objectParts(
      schemas.params,
      components,
      `${key} params`,
    );
    for (const name of templateNames) {
      const schema = properties[name];
      if (!schema) {
        throw new Error(`${key}: path parameter "${name}" has no schema.`);
      }
      parameters.push({ name, in: "path", required: true, schema });
    }
    for (const name of Object.keys(properties)) {
      if (!templateNames.includes(name)) {
        throw new Error(
          `${key}: params schema declares "${name}" not in path.`,
        );
      }
    }
  } else if (templateNames.length > 0) {
    throw new Error(`${key}: path parameters without a params schema.`);
  }

  if (schemas.query) {
    const { properties, required } = objectParts(
      schemas.query,
      components,
      `${key} query`,
    );
    for (const name of Object.keys(properties)) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name) || (clerkSecured && name === "role"),
        schema: properties[name] as Json,
      });
    }
  }

  return parameters;
};

const buildBody = (
  schema: z.ZodType,
  components: ComponentSchemas,
): JsonObject => ({
  required: !schema.safeParse(undefined).success,
  content: {
    "application/json": { schema: convertSchema(schema, "input", components) },
  },
});

const responseDescription = (status: string) =>
  STATUS_CODES[Number(status)] ?? "Response";

const buildResponse = (
  status: string,
  schema: z.ZodType,
  components: ComponentSchemas,
): JsonObject => {
  const converted = convertSchema(schema, "output", components);
  const ref = converted.$ref;
  const id =
    typeof ref === "string"
      ? ref.slice("#/components/schemas/".length)
      : undefined;
  const target = id === undefined ? converted : components[id];
  if (target?.type === "string" && target.format === "binary") {
    if (id !== undefined) delete components[id];
    return {
      description: responseDescription(status),
      content: {
        "application/pdf": { schema: { type: "string", format: "binary" } },
      },
    };
  }
  return {
    description: responseDescription(status),
    content: { "application/json": { schema: converted } },
  };
};

const webhookProvider = (path: string) =>
  path.startsWith("/meetings") ? "daily" : "stripe";

export const buildOpenApiDocument = (
  routes: readonly RouteInfo[],
  options: BuildSpecOptions,
): JsonObject => {
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

    const security = isWebhook ? [] : securityOf(route);
    const operation: JsonObject = { operationId, tags: [tag], security };
    const responses: JsonObject = {};

    if (isWebhook) {
      const provider = webhookProvider(route.path);
      operation.description =
        provider === "daily"
          ? "Daily webhook. Not called by API clients. The raw request body is verified with an HMAC signature from the x-webhook-signature and x-webhook-timestamp headers."
          : "Stripe webhook. Not called by API clients. The raw request body is verified with the Stripe-Signature header.";
      operation.parameters = SIGNATURE_HEADERS[provider]!.map((name) => ({
        name,
        in: "header",
        required: true,
        schema: { type: "string" },
      }));
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              description:
                "Raw JSON event payload, read unparsed so the signature can be verified.",
            },
          },
        },
      };
      responses["200"] = { description: "Event received." };
      responses["400"] = badSignature;
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

export const serializeDocument = (document: JsonObject): string =>
  formatJson(document);
