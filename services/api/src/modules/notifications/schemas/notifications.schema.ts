import { z } from "zod";
import {
  authRoleShape,
  scopeField,
  uuidParam,
} from "../../../shared/validation/schemas/common.schema.js";

export const notificationIdParamsSchema = z.strictObject({
  notificationId: uuidParam("Notification"),
});

export const roleOnlyQuerySchema = z.strictObject({ ...authRoleShape });

export const scopeQuerySchema = z.strictObject({
  ...authRoleShape,
  scope: scopeField(["agency", "default"] as const).optional(),
});
