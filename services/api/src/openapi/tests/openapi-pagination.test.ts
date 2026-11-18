import { describe, expect, it } from "vitest";
import {
  apiRouter,
  identifyAccount,
  isAuthenticated,
  verifyBearerToken,
} from "../../routes/index.js";
import { createOpenApiDocument } from "../document.js";
import { isObject } from "../utils/json.utils.js";
import type { JsonObject } from "../types/openapi.types.js";

const IN_SCOPE_OFFSET_LISTS = [
  "admin_get_accounts",
  "admin_get_contracts",
  "admin_get_job_posts",
  "admin_get_overview_activity",
  "admin_get_proposals",
  "admin_get_transactions",
  "agency_get_search",
  "client_get_marketplace_search",
  "freelancer_get_search",
  "jobs_get_public",
];

const IN_SCOPE_CURSOR_LISTS = ["messaging_get_by_conversation_id_messages"];

const UNPAGINATED_LISTS_PENDING_4B2: string[] = [
  "admin_get_system_redis_keys",
  "agency_get_connects_history",
  "agency_get_invitations_mine",
  "agency_get_jobs",
  "agency_get_proposals",
  "agency_get_proposals_metadata",
  "agency_get_team_invitations",
  "client_get_completed_contracts",
  "connects_get_history",
  "contracts_get_client",
  "contracts_get_freelancer",
  "freelancer_get_jobs",
  "jobs_get",
  "jobs_get_saved",
  "messaging_get",
  "notifications_get",
  "proposals_get_metadata",
];

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

const isListOperation = (operation: Operation) => {
  const data = dataSchema(operation);
  if (data.type === "array") return true;
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

const inScope = [...IN_SCOPE_OFFSET_LISTS, ...IN_SCOPE_CURSOR_LISTS];

describe("paginated list operations", () => {
  it.each(inScope)("%s exists", (operationId) => {
    expect(byId.has(operationId)).toBe(true);
  });

  it.each(IN_SCOPE_OFFSET_LISTS)(
    "%s returns results and hasMore",
    (operationId) => {
      const properties = dataProperties(byId.get(operationId)!);

      expect(Object.keys(properties).sort()).toEqual(["hasMore", "results"]);
      expect(resolve(properties.results).type).toBe("array");
      expect(resolve(properties.hasMore).type).toBe("boolean");
    },
  );

  it.each(IN_SCOPE_CURSOR_LISTS)(
    "%s returns results and nextCursor",
    (operationId) => {
      const properties = dataProperties(byId.get(operationId)!);

      expect(Object.keys(properties).sort()).toEqual(["nextCursor", "results"]);
      expect(resolve(properties.results).type).toBe("array");
    },
  );

  it.each(inScope)("%s documents limit as an integer", (operationId) => {
    const limit = queryParameter(byId.get(operationId)!, "limit");

    expect(resolve(limit?.schema).type).toBe("integer");
  });

  it.each(IN_SCOPE_OFFSET_LISTS)(
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
    const operation = byId.get(IN_SCOPE_CURSOR_LISTS[0]!)!;

    expect(resolve(queryParameter(operation, "limit")?.schema)).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 50,
      default: 30,
    });
  });

  it("keeps the unpaginated allowlist limited to list operations outside the scope", () => {
    const outOfScope = operations
      .filter(
        (operation) =>
          !inScope.includes(operation.operationId) &&
          isListOperation(operation),
      )
      .map((operation) => operation.operationId)
      .sort();

    expect(outOfScope).toEqual([...UNPAGINATED_LISTS_PENDING_4B2].sort());
  });
});
