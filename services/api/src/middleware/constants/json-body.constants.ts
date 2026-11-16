import { API_PREFIX } from "../../config/constants.js";
import type { LargeBodyRoute } from "../types/json-body.types.js";

export const DEFAULT_JSON_LIMIT = "100kb";
export const LARGE_JSON_LIMIT = "20mb";

export const LARGE_BODY_ROUTES: readonly LargeBodyRoute[] = [
  { method: "POST", pattern: new RegExp(`^${API_PREFIX}/jobs/?$`, "i") },
  {
    method: "PUT",
    pattern: new RegExp(`^${API_PREFIX}/jobs/[^/]+/?$`, "i"),
  },
  {
    method: "POST",
    pattern: new RegExp(`^${API_PREFIX}/conversations/[^/]+/messages/?$`, "i"),
  },
  {
    method: "PUT",
    pattern: new RegExp(`^${API_PREFIX}/freelancer/profile/?$`, "i"),
  },
  { method: "PUT", pattern: new RegExp(`^${API_PREFIX}/agency/?$`, "i") },
];
