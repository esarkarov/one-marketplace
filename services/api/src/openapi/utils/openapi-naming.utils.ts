import { API_PREFIX } from "@/config/constants.js";
import {
  MODULE_BY_SEGMENT,
  UNMOUNTED_SEGMENTS,
} from "@/openapi/constants/openapi.constants.js";

const snake = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();

export const titleCase = (value: string) =>
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
