import { STATUS_CODES } from "node:http";
import type { z } from "zod";
import {
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
} from "@/middleware/auth/admin-session.middleware.js";
import { convertSchema } from "@/openapi/conversion/convert-schema.js";
import { isObject } from "@/openapi/utils/json.utils.js";
import {
  ADMIN_SESSION,
  CLERK_BEARER,
  COMPONENTS_PREFIX,
  CONTROLLER_AUTH_OVERRIDES,
  SIGNATURE_HEADERS,
} from "@/openapi/constants/openapi.constants.js";
import type {
  ComponentSchemas,
  Json,
  JsonObject,
} from "@/openapi/types/openapi.types.js";
import {
  routeKey,
  type RouteInfo,
} from "@/openapi/introspection/route-introspection.js";
import type { ValidationSchemas } from "@/middleware/types/validate.types.js";

const ADMIN_GUARDS: ReadonlySet<unknown> = new Set([
  requireAdminSession,
  requireAdminSessionAllowingQueryToken,
]);

export const securityOf = (
  route: RouteInfo,
  clerkGuards: ReadonlySet<unknown>,
) => {
  const clerk = route.handlers.some((handler) => clerkGuards.has(handler));
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
    const target = components[ref.slice(COMPONENTS_PREFIX.length)];
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

export const buildParameters = (
  route: RouteInfo,
  schemas: ValidationSchemas,
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

export const buildBody = (
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

export const buildResponse = (
  status: string,
  schema: z.ZodType,
  components: ComponentSchemas,
): JsonObject => {
  const converted = convertSchema(schema, "output", components);
  const ref = converted.$ref;
  const id =
    typeof ref === "string" ? ref.slice(COMPONENTS_PREFIX.length) : undefined;
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

export const buildWebhookOperation = (
  path: string,
  badSignature: JsonObject,
): { fields: JsonObject; responses: JsonObject } => {
  const provider = path.startsWith("/meetings") ? "daily" : "stripe";
  const description =
    provider === "daily"
      ? "Daily webhook. Not called by API clients. The raw request body is verified with an HMAC signature from the x-webhook-signature and x-webhook-timestamp headers."
      : "Stripe webhook. Not called by API clients. The raw request body is verified with the Stripe-Signature header.";
  const parameters = SIGNATURE_HEADERS[provider]!.map((name) => ({
    name,
    in: "header",
    required: true,
    schema: { type: "string" },
  }));
  const requestBody = {
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
  return {
    fields: { description, parameters, requestBody },
    responses: {
      "200": { description: "Event received." },
      "400": badSignature,
    },
  };
};
