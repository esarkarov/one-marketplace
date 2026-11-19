import { z } from "zod";
import type { RequestSchemas } from "../../../middleware/types/validate.types.js";

import {
  authRoleShape,
  roleField,
} from "../../../shared/validation/schemas/common.schema.js";

export const signUpBodySchema = z.strictObject({ role: roleField });

export const authStatusQuerySchema = z.strictObject(authRoleShape);

export const signUpRequest = {
  body: signUpBodySchema,
  query: {},
} satisfies RequestSchemas;
