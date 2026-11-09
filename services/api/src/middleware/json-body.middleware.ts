import express from "express";
import type { RequestHandler } from "express";
import { API_PREFIX } from "../config/constants.js";

const DEFAULT_JSON_LIMIT = "100kb";
const LARGE_JSON_LIMIT = "20mb";

interface LargeBodyRoute {
  method: string;
  pattern: RegExp;
}

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

export const isLargeBodyRoute = (method: string, path: string): boolean =>
  LARGE_BODY_ROUTES.some(
    (route) => route.method === method && route.pattern.test(path),
  );

const defaultParser = express.json({ limit: DEFAULT_JSON_LIMIT });
export const largeJsonBody: RequestHandler = express.json({
  limit: LARGE_JSON_LIMIT,
});

export const jsonBody: RequestHandler = (request, response, next) => {
  if (isLargeBodyRoute(request.method, request.path)) {
    next();
    return;
  }

  defaultParser(request, response, next);
};
