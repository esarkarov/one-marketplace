import { logger } from "../../config/logger.js";
import { ApiError } from "../errors/api-error.js";

export const requirePublicId = (
  id: string | null | undefined,
  operation: string,
  rowId: string,
): string => {
  if (id) return id;
  void logger.error({
    message: "Public id could not be resolved",
    eventName: "api.public_id.unresolved",
    attributes: { operation, "row.id": rowId },
  });
  throw new ApiError(500, "Internal server error.", "INTERNAL_ERROR");
};
