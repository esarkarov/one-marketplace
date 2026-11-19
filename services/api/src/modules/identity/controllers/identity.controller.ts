import { RequestHandler } from "express";
import { ApiError } from "@/shared/errors/api-error.js";
import { asyncHandler } from "@/middleware/utils/async-handler.utils.js";
import { getValidated } from "@/middleware/utils/validated-request.utils.js";
import { identitySessionRequest } from "@/modules/identity/schemas/identity.schema.js";
import { createIdentitySession } from "@/modules/identity/services/identity.service.js";
import { handleIdentityWebhook } from "@/modules/identity/services/identity.webhook.service.js";

export const startIdentityVerification: RequestHandler = asyncHandler(
  async (request, response) => {
    if (!request.auth) throw new ApiError(401, "Authentication is required.");

    const { query } = getValidated(request, identitySessionRequest);
    const url = await createIdentitySession(
      request.auth.userId,
      request.auth.role,
      query.context === "agency" ? "agency" : undefined,
    );
    response.status(200).json({
      success: true,
      message: "Identity verification session created.",
      data: { url },
    });
  },
);

export const identityWebhook: RequestHandler = asyncHandler(
  async (request, response) => {
    await handleIdentityWebhook(request);

    response.status(200).json({ received: true });
  },
);
