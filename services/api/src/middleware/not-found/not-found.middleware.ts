import { RequestHandler } from "express";
import { ApiError } from "../../shared/errors/api-error.js";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApiError(404, "Route not found."));
};
