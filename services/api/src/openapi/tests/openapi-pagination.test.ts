import { describe, expect, it } from "vitest";
import {
  apiRouter,
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "@/routes/index.js";
import { createOpenApiDocument } from "@/openapi/document.js";
import { isObject } from "@/openapi/utils/json.utils.js";
import type { JsonObject } from "@/openapi/types/openapi.types.js";

const OFFSET_LISTS: Record<string, string[]> = {
  admin_get_accounts: [],
  admin_get_contracts: [],
  admin_get_job_posts: [],
  admin_get_overview_activity: [],
  admin_get_proposals: [],
  admin_get_transactions: [],
  agency_get_connects_history: [],
  agency_get_invitations_mine: [],
  agency_get_jobs: [],
  agency_get_proposals: [],
  agency_get_proposals_metadata: ["counts"],
  agency_get_search: [],
  agency_get_team_invitations: [],
  client_get_completed_contracts: [],
  client_get_marketplace_search: [],
  connects_get_history: [],
  contracts_get_client: [],
  contracts_get_freelancer: [],
  freelancer_get_jobs: [],
  freelancer_get_search: [],
  jobs_get: [],
  jobs_get_public: [],
  jobs_get_saved: [],
  messaging_get: ["totalUnread"],
  notifications_get: [],
  proposals_get: [],
  proposals_get_metadata: ["counts"],
};

const CURSOR_LISTS = ["messaging_get_by_conversation_id_messages"];

const EXEMPT_LISTS: Record<string, string> = {
  admin_get_system_redis_keys:
    "a Redis SCAN hard-capped at 200 keys in code, answered as { keys, truncated } rather than a bare array",
};

const document = createOpenApiDocument(apiRouter, [
  isAuthenticated,
  identifyAccount,
  verifyBearerToken,
]);
const schemas = (document.components as JsonObject).schemas as Record<
  string,
  JsonObject
>;

const resolve = (node: unknown): JsonObject => {
  if (!isObject(node)) return {};
  const ref = node.$ref;
  if (typeof ref === "string") {
    return resolve(schemas[ref.split("/").pop() ?? ""]);
  }
  return node;
};

interface Operation {
  operationId: string;
  parameters?: JsonObject[];
  responses?: JsonObject;
}

const getOperations = (): Operation[] => {
  const paths = document.paths as Record<string, JsonObject>;
  return Object.values(paths).flatMap((item) =>
    isObject(item.get) ? [item.get as unknown as Operation] : [],
  );
};

const dataSchema = (operation: Operation) => {
  const ok = resolve(operation.responses?.["200"]);
  const content = resolve(ok.content);
  const json = resolve(content["application/json"]);
  const body = resolve(json.schema);
  return resolve(resolve(body.properties).data);
};

const dataProperties = (operation: Operation) =>
  resolve(dataSchema(operation).properties);

const isArraySchema = (node: unknown): boolean => {
  const schema = resolve(node);
  if (schema.type === "array") return true;
  const variants = [schema.anyOf, schema.oneOf].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );
  return variants.some(isArraySchema);
};

const isListOperation = (operation: Operation) => {
  const data = dataSchema(operation);
  if (isArraySchema(data)) return true;
  const properties = Object.values(dataProperties(operation));
  return (
    properties.length <= 2 &&
    properties.some((property) => resolve(property).type === "array")
  );
};

const queryParameter = (operation: Operation, name: string) =>
  operation.parameters?.find(
    (parameter) => parameter.in === "query" && parameter.name === name,
  );

const operations = getOperations();
const byId = new Map(
  operations.map((operation) => [operation.operationId, operation]),
);

const offsetIds = Object.keys(OFFSET_LISTS);
const paginatedIds = [...offsetIds, ...CURSOR_LISTS];

describe("paginated list operations", () => {
  it.each(paginatedIds)("%s exists", (operationId) => {
    expect(byId.has(operationId)).toBe(true);
  });

  it.each(offsetIds)("%s returns results and hasMore", (operationId) => {
    const properties = dataProperties(byId.get(operationId)!);

    expect(Object.keys(properties).sort()).toEqual(
      ["hasMore", "results", ...OFFSET_LISTS[operationId]!].sort(),
    );
    expect(resolve(properties.results).type).toBe("array");
    expect(resolve(properties.hasMore).type).toBe("boolean");
  });

  it.each(CURSOR_LISTS)("%s returns results and nextCursor", (operationId) => {
    const properties = dataProperties(byId.get(operationId)!);

    expect(Object.keys(properties).sort()).toEqual(["nextCursor", "results"]);
    expect(resolve(properties.results).type).toBe("array");
  });

  it.each(paginatedIds)("%s documents limit as an integer", (operationId) => {
    const limit = queryParameter(byId.get(operationId)!, "limit");

    expect(resolve(limit?.schema).type).toBe("integer");
  });

  it.each(offsetIds)(
    "%s documents limit and offset with the shared bounds",
    (operationId) => {
      const operation = byId.get(operationId)!;

      expect(resolve(queryParameter(operation, "limit")?.schema)).toMatchObject(
        { type: "integer", minimum: 1, maximum: 100, default: 20 },
      );
      expect(
        resolve(queryParameter(operation, "offset")?.schema),
      ).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 10000,
        default: 0,
      });
    },
  );

  it("documents the messages limit exception", () => {
    const operation = byId.get(CURSOR_LISTS[0]!)!;

    expect(resolve(queryParameter(operation, "limit")?.schema)).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 50,
      default: 30,
    });
  });

  it("paginates every GET operation whose data holds results", () => {
    const withResults = operations
      .filter((operation) => "results" in dataProperties(operation))
      .map((operation) => operation.operationId)
      .sort();

    expect(withResults).toEqual([...paginatedIds].sort());
  });

  it("leaves no list operation unpaginated except the exempt ones", () => {
    const unpaginated = operations
      .filter(
        (operation) =>
          isListOperation(operation) &&
          !paginatedIds.includes(operation.operationId),
      )
      .map((operation) => operation.operationId)
      .sort();

    expect(unpaginated).toEqual(Object.keys(EXEMPT_LISTS).sort());
  });

  it.each(Object.entries(EXEMPT_LISTS))(
    "exempt %s states its reason",
    (operationId, reason) => {
      expect(byId.has(operationId)).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    },
  );

  it("never answers a bare array in data", () => {
    const bare = operations
      .filter(
        (operation) =>
          isArraySchema(dataSchema(operation)) &&
          !(operation.operationId in EXEMPT_LISTS),
      )
      .map((operation) => operation.operationId);

    expect(bare).toEqual([]);
  });
});
