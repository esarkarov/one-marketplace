import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const requestIdMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const incoming = request.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();

  request.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
};
