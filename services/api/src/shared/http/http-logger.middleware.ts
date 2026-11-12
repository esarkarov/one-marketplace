import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { createAppLogger, rootLogger } from "../../config/logger.js";
import { API_PREFIX } from "../../config/constants.js";

const IGNORED_PATHS = new Set([`${API_PREFIX}/health`, `${API_PREFIX}/ready`]);

const pathOf = (url: string | undefined): string => {
  const raw = url ?? "";
  const index = raw.indexOf("?");
  return index === -1 ? raw : raw.slice(0, index);
};

export const createHttpLogger = (
  base: Logger = rootLogger,
): RequestHandler[] => {
  const httpLogger = pinoHttp({
    logger: base,
    genReqId: (request) => (request as { requestId?: string }).requestId ?? "",
    autoLogging: {
      ignore: (request) =>
        request.method === "GET" && IGNORED_PATHS.has(pathOf(request.url)),
    },
    serializers: {
      req: (request: { id: string; method: string; url: string }) => ({
        id: request.id,
        method: request.method,
        url: pathOf(request.url),
      }),
      res: (response: { statusCode: number }) => ({
        statusCode: response.statusCode,
      }),
    },
  }) as unknown as RequestHandler;

  const attach: RequestHandler = (request, _response, next) => {
    request.logger = createAppLogger(request.log);
    next();
  };

  return [httpLogger, attach];
};
