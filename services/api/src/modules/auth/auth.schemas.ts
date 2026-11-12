import { z } from "zod";

import {
  authRoleShape,
  roleField,
} from "../../shared/validation/common-schemas.js";

export const signUpBodySchema = z.strictObject({ role: roleField });

export const authStatusQuerySchema = z.strictObject(authRoleShape);
