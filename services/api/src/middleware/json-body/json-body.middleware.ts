import express from "express";
import type { RequestHandler } from "express";
import {
  DEFAULT_JSON_LIMIT,
  LARGE_BODY_ROUTES,
  LARGE_JSON_LIMIT,
} from "@/middleware/constants/json-body.constants.js";

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
