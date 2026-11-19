import type { Json, JsonObject } from "@/openapi/types/openapi.types.js";

const PRINT_WIDTH = 80;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const sortKeys = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    const sorted: JsonObject = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      sorted[key] = sortKeys(child);
    }
    return sorted;
  }
  return value;
};

const isScalar = (value: Json) => !Array.isArray(value) && !isObject(value);

const format = (
  value: Json,
  depth: number,
  lead: number,
  tail: number,
): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isScalar)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (lead + inline.length + tail <= PRINT_WIDTH) return inline;
    }
    const pad = "  ".repeat(depth + 1);
    const items = value.map((item, index) =>
      format(item, depth + 1, pad.length, index === value.length - 1 ? 0 : 1),
    );
    return `[\n${items.map((item) => `${pad}${item}`).join(",\n")}\n${"  ".repeat(depth)}]`;
  }
  if (isObject(value)) {
    const fields = Object.entries(value);
    if (fields.length === 0) return "{}";
    const pad = "  ".repeat(depth + 1);
    const entries = fields.map(([key, child], index) => {
      const prefix = `${JSON.stringify(key)}: `;
      return `${pad}${prefix}${format(
        child,
        depth + 1,
        pad.length + prefix.length,
        index === fields.length - 1 ? 0 : 1,
      )}`;
    });
    return `{\n${entries.join(",\n")}\n${"  ".repeat(depth)}}`;
  }
  return JSON.stringify(value);
};

export const formatJson = (value: Json): string =>
  `${format(sortKeys(value), 0, 0, 0)}\n`;
